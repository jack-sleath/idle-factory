import type { Tile } from './renderer'

// A handful of static sprite tiles used to prove out the canvas pipeline in
// Milestone 1 (a pannable scene of Twemoji sprites). The real, interactive
// world model arrives in Milestone 2.
export const DEMO_TILES: Tile[] = [
  { cx: 0, cy: 0, emoji: '⛏️' }, // ore gatherer
  { cx: 1, cy: 0, emoji: '➡️' },
  { cx: 2, cy: 0, emoji: '➡️' },
  { cx: 3, cy: 0, emoji: '📦' }, // storage
  { cx: 0, cy: 1, emoji: '🪨' }, // ore
  { cx: 0, cy: 2, emoji: '🐄' }, // cow spawner
  { cx: 1, cy: 2, emoji: '➡️' },
  { cx: 2, cy: 2, emoji: '🥛' }, // milk
]
