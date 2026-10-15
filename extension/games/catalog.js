// The game catalog. Every entry is a module shipped inside the extension (Web Store forbids remote code).
// The server's /catalog only adds metadata (global tops, featured flag, play counts) on top of this.
export const CATALOG = [
  {
    id: "snake",
    title: "Snake",
    genre: "Classic",
    tagline: "Eat, grow, don't bite yourself. Golden fruit is worth five.",
    controls: "Arrows / WASD / swipe. Space toggles the AI autopilot.",
    ai: "Built-in autopilot you can switch on mid-run to see how a pathfinder plays.",
    load: () => import("./snake/game.js"),
    status: "ready",
  },
  {
    id: "pipedream",
    title: "PipeDream",
    genre: "Puzzle",
    tagline: "Lay pipe ahead of the flow. Water, oil and gas each break the rules differently.",
    controls: "Click or tap a cell to place the next piece.",
    ai: "Hint mode suggests the best cell for the next piece.",
    load: null,
    status: "soon",
  },
  { id: "breakout", title: "Brick Break", genre: "Arcade", tagline: "One ball, one paddle, a wall that fights back.", load: null, status: "soon" },
  { id: "stacker", title: "Stacker", genre: "Puzzle", tagline: "Falling blocks, rising pressure.", load: null, status: "soon" },
  { id: "rocks", title: "Rock Field", genre: "Shooter", tagline: "Spin, thrust, shoot. Don't drift into the rocks.", load: null, status: "soon" },
  { id: "maze", title: "Maze Chase", genre: "Arcade", tagline: "Four AI chasers, one maze, every dot.", load: null, status: "soon" },
];
