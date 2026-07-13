import type { Camera } from '../render/camera'

// Single source of truth for tunable game configuration (see the NFRs). The
// world is unbounded, so there is deliberately no grid-size setting here.
// Per-item prices live in data/items.json; per-buildable costs in
// data/catalog.json. Some fields are consumed by later milestones (market,
// offline catch-up) but are defined here now so all tuning lives in one place.
export const config = {
  /** Save schema version (bumped when the persisted shape or item set changes). */
  saveVersion: 5,

  /** Simulation tick length in milliseconds (M3). */
  tickMs: 500,

  /** Stock-market update cadence in minutes (M7). */
  marketIntervalMinutes: 5,
  /** Market volatility: factor range is ×[1/(1+v), (1+v)] (M7). */
  volatility: 0.2,

  /** Starting money for a new game (M6). */
  startingMoney: 0,

  /** Item id produced as the fallback "junk" output (M4). */
  junkItemId: 'junk',

  /** Offline catch-up cap, applied to both market and production (M9). */
  maxOfflineHours: 24,
  /** Length of the headless production sampling window (M9). */
  offlineSampleSeconds: 60,
  /** Warm-up before sampling, to let belts fill (M9). */
  offlineWarmupSeconds: 5,

  /** Large-number formatting style (M5). */
  numberFormat: 'short' as const,

  /** Initial camera (world coord at viewport centre + pixels-per-cell). */
  camera: { x: 1, y: 0, zoom: 72 } as Camera,
  /** Zoom clamp (pixels per cell). */
  zoomMin: 24,
  zoomMax: 200,

  /** Cell span of a spatial chunk, used for viewport culling. */
  chunkSize: 16,
}

export type Config = typeof config
