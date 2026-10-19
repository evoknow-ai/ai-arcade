# AI Arcade

A Chrome extension (Manifest V3) that is a store of classic arcade games with AI opponents,
plus a self-hosted Go leaderboard server. By EVOKNOW.

```
extension/            the Chrome extension — load this folder unpacked
  manifest.json
  config.js           API_BASE: point this at your server
  background.js       opens the store tab, queues/flushes scores, refreshes catalog
  store/              the store page (game list, attract mode, play view, leaderboard)
  shell/              GameShell runtime: loop, input, audio, RNG, replay log, storage
  games/catalog.js    the list of games shipped with the extension
  games/<id>/game.js  one module per game
server/               Go + SQLite leaderboard API
```

## Current phase: local-first

`API_BASE` in `extension/config.js` is empty, so the extension runs fully local: every finished run is
stored in `chrome.storage.local` and the in-game leaderboard panel shows your own scores (today / week /
all time). The Go server in `server/` is ready for the global leaderboard phase — set `API_BASE` to
`https://eatsleepai.us/arcade/api` to switch it on.

## Run the extension

1. `chrome://extensions` → Developer mode → Load unpacked → pick `extension/`.
2. Click the toolbar icon. The store opens in its own tab.
3. Without a server it still works: scores save locally and queue for later.

## Run the server

```
cd server
go mod tidy
go build -o arcade-server .
./arcade-server -addr :8080 -db arcade.db -featured snake
```

or `docker build -t arcade-server . && docker run -p 8080:8080 -v arcade-data:/data arcade-server`.

Put it behind nginx with TLS (see `nginx.conf.example`, which adds one `location /arcade/api/` block to the Ghost site config) and set `API_BASE` in `extension/config.js`
and `host_permissions` in `manifest.json` to that host.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/catalog` | featured game id, top score + play count per game |
| GET | `/api/leaderboard/{game}?period=daily\|weekly\|all` | top 50, best score per player |
| POST | `/api/players` | `{playerId, name, secret}` — HMAC signed |
| POST | `/api/scores` | score + replay log — HMAC signed |

### Anti-cheat

Every install gets a random player id + secret. Requests are HMAC-SHA256 signed; the first
signed request registers the pair (trust on first use). Each game records a compact input log
(`[tick, action, tick, action, …]`) plus the RNG seed. For games with a Go port of their rules
(currently Snake, `server/snake_replay.go`), the server replays the log and rejects any score that
does not match. Other games get a points-per-second sanity cap until their replay is ported.
Names are 2–12 chars, filtered for profanity. Score posts are rate limited per IP.

## Adding a game

1. Create `extension/games/<id>/game.js` exporting a factory that returns
   `{ id, tps, size, score, level, init(shell), onInput(action, shell), update(shell), render(ctx, shell), hud() }`.
   Use `shell.rng` for all randomness and call `shell.end()` on game over.
2. Add it to `extension/games/catalog.js`.
3. Optional: port the rules to `server/<id>_replay.go` and add a case in `scores()` for verified scores.

## Roadmap

- [x] Store page, GameShell (keyboard/touch/pointer/gamepad, audio, replay log), local leaderboard
- [x] PipeDream — level timer, start-now bonus, time bombs, water/oil/gas, reservoirs, valves, Magic Blocks, Timer Blocks, AI hint
- [x] Themes (Aurora, Midnight, Sunset, Terminal) and Beginner / Intermediate / Advanced difficulty
- [x] Snake with AI autopilot
- [x] Scorched Ridge — artillery vs AI gunner, 8 weapons (digger, foundation breaker, cluster, guided, smart, drone…), armory with shields/armor/barrel, troops, six scenes with weather and wildlife
- [x] Credits wallet shared across games (persisted in chrome.storage)
- [x] Mine Field — minesweeper with chords, flag mode, and a logic-solver hint
- [x] Missile Defence — six cities, MIRVs that burst mid-air, evasive smart warheads, bombers, day/night cycle, depot (placeable batteries, area shields, Patriot launcher, missile truck, flak turret), credits per kill
- [x] Solitaire — Klondike with drag or click-to-move, draw 1/3, limited passes on Advanced, move hint
- [x] Brick Break — power-ups (wide, multiball, slow, sticky, +1), armoured bricks, combo scoring
- [x] Stacker — ghost piece, next preview, DAS, hard drop, combo line clears, AI hint
- [x] Rock Field — splitting rocks, saucers that shoot back, hyperspace, extra ships
- [x] Maze Chase — four chaser AIs, power pellets, fruit, queued turns, BFS autopilot
- [x] Asteroid Belt — scrolling belt, ore mining for credits, shield and rapid-fire pickups
- [x] Chopper Command — convoy defence over a scrolling desert with radar, jets, gunships and bombs
- [x] Lunar Lander — pads with multipliers, fuel that carries over, flight instruments, autopilot
- [x] Chess — full rules, alpha-beta engine with piece-square tables, drag or click, hints, move list
- [x] Rail Switch — numbered destinations, drag-drawn S-curve crossovers, tap-to-hold trains, day/night with ghost and skull trains, look-ahead collision warning and hint (inspired by Train Conductor)
- [x] Invaders — 55-alien formation, pixel-destructible bunkers, saucer, nebula/planet/warp backdrop, CRT finish
- [ ] Global leaderboard on eatsleepai.us (server already written; needs PipeDream replay port)
- [ ] Ghost replay of the #1 run
- [ ] Chrome Web Store listing
