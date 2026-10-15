// AI Arcade leaderboard server.
//   go build -o arcade-server . && ./arcade-server -addr :8080 -db arcade.db
// Endpoints (all under /api):
//   GET  /catalog                      -> featured game + top score per game + play counts
//   GET  /leaderboard/{game}?period=   -> daily | weekly | all (default), top 50
//   POST /players                      -> {playerId,name}  (HMAC signed)
//   POST /scores                       -> score entry (HMAC signed, replay-verified for known games)
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	nameRe   = regexp.MustCompile(`^[A-Za-z0-9 _.\-]{2,12}$`)
	badWords = []string{"fuck", "shit", "cunt", "nigg", "fag", "bitch", "dick", "ass ", "porn"}
)

type Server struct {
	db       *sql.DB
	featured string
	limiter  *limiter
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "arcade.db", "sqlite path")
	featured := flag.String("featured", "snake", "featured game id")
	flag.Parse()

	db, err := sql.Open("sqlite", *dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(schema); err != nil {
		log.Fatal(err)
	}
	s := &Server{db: db, featured: *featured, limiter: newLimiter(30, time.Minute)}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/catalog", s.catalog)
	mux.HandleFunc("GET /api/leaderboard/{game}", s.leaderboard)
	mux.HandleFunc("POST /api/players", s.players)
	mux.HandleFunc("POST /api/scores", s.scores)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })

	log.Printf("arcade server on %s (db %s)", *addr, *dbPath)
	log.Fatal(http.ListenAndServe(*addr, cors(mux)))
}

const schema = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, secret TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Player',
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, player_id TEXT NOT NULL,
  name TEXT NOT NULL, score INTEGER NOT NULL, level INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS scores_game_ts ON scores(game, ts);
CREATE INDEX IF NOT EXISTS scores_game_score ON scores(game, score DESC);
`

// ---- identity: first signed request registers the (id, secret) pair; later requests must match.
func (s *Server) auth(r *http.Request, body []byte) (string, bool) {
	id := r.Header.Get("X-Player")
	sig := r.Header.Get("X-Signature")
	if id == "" || sig == "" || len(id) > 64 {
		return "", false
	}
	var secret string
	err := s.db.QueryRow(`SELECT secret FROM players WHERE id=?`, id).Scan(&secret)
	if err == sql.ErrNoRows {
		// Trust-on-first-use: the client sends its secret once in the body of /players.
		return id, false
	}
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return id, hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(sig))
}

func (s *Server) players(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	var in struct {
		PlayerID string `json:"playerId"`
		Name     string `json:"name"`
		Secret   string `json:"secret"` // only honored on first registration
	}
	if json.Unmarshal(body, &in) != nil || in.PlayerID == "" {
		http.Error(w, "bad request", 400)
		return
	}
	if !cleanName(in.Name) {
		http.Error(w, "name not allowed", 422)
		return
	}
	id, ok := s.auth(r, body)
	now := time.Now().UnixMilli()
	if !ok {
		// first contact: register with the secret proven by the signature itself
		if in.Secret == "" || id != in.PlayerID || !verify(in.Secret, body, r.Header.Get("X-Signature")) {
			http.Error(w, "unauthorized", 401)
			return
		}
		_, err := s.db.Exec(`INSERT OR IGNORE INTO players(id,secret,name,created_at,last_seen) VALUES(?,?,?,?,?)`, id, in.Secret, in.Name, now, now)
		if err != nil {
			http.Error(w, "db", 500)
			return
		}
	}
	s.db.Exec(`UPDATE players SET name=?, last_seen=? WHERE id=?`, in.Name, now, id)
	s.db.Exec(`UPDATE scores SET name=? WHERE player_id=?`, in.Name, id)
	w.WriteHeader(204)
}

type scoreIn struct {
	GameID     string `json:"gameId"`
	Score      int    `json:"score"`
	Level      int    `json:"level"`
	DurationMs int    `json:"durationMs"`
	PlayerID   string `json:"playerId"`
	Name       string `json:"name"`
	Secret     string `json:"secret"`
	Log        struct {
		Seed   uint32 `json:"seed"`
		Events []int  `json:"events"`
		Ticks  int    `json:"ticks"`
	} `json:"log"`
}

func (s *Server) scores(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r)) {
		http.Error(w, "slow down", 429)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var in scoreIn
	if json.Unmarshal(body, &in) != nil || in.GameID == "" || in.Score < 0 || in.Score > 10_000_000 {
		http.Error(w, "bad request", 400)
		return
	}
	id, ok := s.auth(r, body)
	now := time.Now().UnixMilli()
	if !ok {
		if in.Secret == "" || id != in.PlayerID || !verify(in.Secret, body, r.Header.Get("X-Signature")) {
			http.Error(w, "unauthorized", 401)
			return
		}
		s.db.Exec(`INSERT OR IGNORE INTO players(id,secret,name,created_at,last_seen) VALUES(?,?,?,?,?)`, id, in.Secret, "Player", now, now)
	}
	if !cleanName(in.Name) {
		in.Name = "Player"
	}
	verified := 0
	switch in.GameID {
	case "snake":
		got, ok := replaySnake(in.Log.Seed, in.Log.Events, in.Log.Ticks)
		if !ok || got != in.Score {
			log.Printf("reject snake score %d (replay %d ok=%v) from %s", in.Score, got, ok, id)
			http.Error(w, "score could not be verified", 422)
			return
		}
		verified = 1
	default:
		// unknown/unverified game: accept but cap at a sane rate of points per second
		if in.DurationMs > 0 && float64(in.Score)/float64(in.DurationMs)*1000 > 500 {
			http.Error(w, "score could not be verified", 422)
			return
		}
	}
	_, err := s.db.Exec(`INSERT INTO scores(game,player_id,name,score,level,duration_ms,verified,ts) VALUES(?,?,?,?,?,?,?,?)`,
		in.GameID, id, in.Name, in.Score, in.Level, in.DurationMs, verified, now)
	if err != nil {
		http.Error(w, "db", 500)
		return
	}
	s.db.Exec(`UPDATE players SET last_seen=?, name=? WHERE id=?`, now, in.Name, id)
	w.WriteHeader(204)
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	game := r.PathValue("game")
	since := int64(0)
	switch r.URL.Query().Get("period") {
	case "daily":
		since = time.Now().Add(-24 * time.Hour).UnixMilli()
	case "weekly":
		since = time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	}
	// best score per player
	rows, err := s.db.Query(`SELECT player_id, name, MAX(score) AS score, level, ts FROM scores
		WHERE game=? AND ts>=? GROUP BY player_id ORDER BY score DESC, ts ASC LIMIT 50`, game, since)
	if err != nil {
		http.Error(w, "db", 500)
		return
	}
	defer rows.Close()
	type row struct {
		PlayerID string `json:"playerId"`
		Name     string `json:"name"`
		Score    int    `json:"score"`
		Level    int    `json:"level"`
		Ts       int64  `json:"ts"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		rows.Scan(&x.PlayerID, &x.Name, &x.Score, &x.Level, &x.Ts)
		out = append(out, x)
	}
	writeJSON(w, out)
}

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	type top struct {
		Name  string `json:"name"`
		Score int    `json:"score"`
	}
	type info struct {
		Top   *top `json:"top,omitempty"`
		Plays int  `json:"plays"`
	}
	games := map[string]*info{}
	rows, err := s.db.Query(`SELECT game, name, score, (SELECT COUNT(*) FROM scores s2 WHERE s2.game=s1.game)
		FROM scores s1 WHERE id IN (SELECT id FROM scores s3 WHERE s3.game=s1.game ORDER BY score DESC, ts ASC LIMIT 1)`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var g, n string
			var sc, plays int
			rows.Scan(&g, &n, &sc, &plays)
			games[g] = &info{Top: &top{n, sc}, Plays: plays}
		}
	}
	writeJSON(w, map[string]any{"featured": s.featured, "games": games, "generatedAt": time.Now().UnixMilli()})
}

// ---- helpers
func verify(secret string, body []byte, sig string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(sig))
}
func cleanName(n string) bool {
	if !nameRe.MatchString(n) {
		return false
	}
	l := strings.ToLower(n)
	for _, b := range badWords {
		if strings.Contains(l, b) {
			return false
		}
	}
	return true
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}
func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	return strings.Split(r.RemoteAddr, ":")[0]
}
func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Player, X-Signature")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		h.ServeHTTP(w, r)
	})
}

type limiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	n      int
	window time.Duration
}

func newLimiter(n int, window time.Duration) *limiter {
	return &limiter{hits: map[string][]time.Time{}, n: n, window: window}
}
func (l *limiter) allow(k string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	keep := l.hits[k][:0]
	for _, t := range l.hits[k] {
		if now.Sub(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= l.n {
		l.hits[k] = keep
		return false
	}
	l.hits[k] = append(keep, now)
	return true
}
