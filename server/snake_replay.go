package main

// Deterministic replay of extension/games/snake/game.js. Any change to the JS rules
// must be mirrored here, or scores for Snake will be rejected.

const (
	cols, rows = 24, 24
	actUp, actDown, actLeft, actRight, actAction = 1, 2, 3, 4, 5
)

type rng struct{ s uint32 }

func (r *rng) next() float64 { // mulberry32, identical to GameShell.RNG
	r.s += 0x6D2B79F5
	t := r.s
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64(t^(t>>14)) / 4294967296
}
func (r *rng) intn(n int) int { return int(r.next() * float64(n)) }

type pt struct{ x, y int }

var dirs = map[int]pt{actUp: {0, -1}, actDown: {0, 1}, actLeft: {-1, 0}, actRight: {1, 0}}
var opp = map[int]int{actUp: actDown, actDown: actUp, actLeft: actRight, actRight: actLeft}

func replaySnake(seed uint32, events []int, ticks int) (int, bool) {
	if len(events)%2 != 0 || ticks <= 0 || ticks > 60*60*60*4 {
		return 0, false
	}
	r := &rng{s: seed}
	if r.s == 0 {
		r.s = 1
	}
	snake := []pt{{12, 12}, {11, 12}, {10, 12}}
	occupied := func(p pt) bool {
		for _, s := range snake {
			if s == p {
				return true
			}
		}
		return false
	}
	spawn := func() pt {
		for {
			p := pt{r.intn(cols), r.intn(rows)}
			if !occupied(p) {
				return p
			}
		}
	}
	dir, next := actRight, actRight
	score, level, eaten, moveEvery, acc := 0, 1, 0, 9, 0
	fruit := spawn()
	var golden *pt
	goldenTtl := 0
	autopilot := false
	ei := 0
	for tick := 1; tick <= ticks; tick++ {
		for ei < len(events) && events[ei] == tick {
			a := events[ei+1]
			ei += 2
			if _, ok := dirs[a]; ok && a != opp[dir] {
				next = a
			}
			if a == actAction {
				autopilot = !autopilot
			}
		}
		acc++
		if acc < moveEvery {
			continue
		}
		acc = 0
		if autopilot {
			if d := aiPick(snake, dir, fruit, golden); d != 0 {
				next = d
			}
		}
		dir = next
		d := dirs[dir]
		head := pt{snake[0].x + d.x, snake[0].y + d.y}
		if head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows || occupied(head) {
			return score, true // game ended here; remaining ticks are ignored
		}
		snake = append([]pt{head}, snake...)
		switch {
		case golden != nil && head == *golden:
			score += 50 * level
			golden = nil
		case head == fruit:
			score += 10 * level
			eaten++
			fruit = spawn()
			if eaten%5 == 0 {
				level++
				if moveEvery > 3 {
					moveEvery--
				}
			}
			if golden == nil && r.next() < 0.2 {
				g := spawn()
				golden = &g
				goldenTtl = 60
			}
		default:
			snake = snake[:len(snake)-1]
		}
		if golden != nil {
			goldenTtl--
			if goldenTtl <= 0 {
				golden = nil
			}
		}
	}
	return score, true
}

func aiPick(snake []pt, dir int, fruit pt, golden *pt) int {
	target := fruit
	if golden != nil {
		target = *golden
	}
	body := map[pt]bool{}
	for _, s := range snake {
		body[s] = true
	}
	if d := bfs(snake[0], target, body); d != 0 {
		return d
	}
	tail := snake[len(snake)-1]
	delete(body, tail)
	if d := bfs(snake[0], tail, body); d != 0 {
		return d
	}
	for _, d := range []int{actUp, actDown, actLeft, actRight} {
		if d == opp[dir] {
			continue
		}
		n := pt{snake[0].x + dirs[d].x, snake[0].y + dirs[d].y}
		if n.x >= 0 && n.y >= 0 && n.x < cols && n.y < rows && !body[n] {
			return d
		}
	}
	return 0
}

// bfs explores neighbors in JS Object.entries order: up, down, left, right.
func bfs(start, goal pt, blocked map[pt]bool) int {
	type node struct {
		p     pt
		first int
	}
	q := []node{{start, 0}}
	seen := map[pt]bool{start: true}
	order := []int{actUp, actDown, actLeft, actRight}
	for len(q) > 0 {
		n := q[0]
		q = q[1:]
		for _, d := range order {
			np := pt{n.p.x + dirs[d].x, n.p.y + dirs[d].y}
			if np.x < 0 || np.y < 0 || np.x >= cols || np.y >= rows || blocked[np] || seen[np] {
				continue
			}
			first := n.first
			if first == 0 {
				first = d
			}
			if np == goal {
				return first
			}
			seen[np] = true
			q = append(q, node{np, first})
		}
	}
	return 0
}
