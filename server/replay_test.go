package main

import "testing"

func TestReplayNoInput(t *testing.T) {
	// snake moves right from (12,12); hits the wall at x=24 after 12 moves of 9 ticks
	score, ok := replaySnake(7, nil, 10000)
	if !ok || score != 0 {
		t.Fatalf("got %d ok=%v", score, ok)
	}
}
func TestAutopilotScores(t *testing.T) {
	score, ok := replaySnake(7, []int{1, actAction}, 60 * 120)
	t.Logf("autopilot score after 2 min: %d", score)
	if !ok || score <= 0 {
		t.Fatalf("got %d ok=%v", score, ok)
	}
}
