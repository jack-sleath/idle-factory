import type { Camera } from '../render/camera'

// Single source of truth for tunable game configuration (see the NFRs). The
// world is unbounded, so there is deliberately no grid-size setting here.
// Per-item prices live in data/items.json; per-buildable costs in
// data/catalog.json. Some fields are consumed by later milestones (market,
// offline catch-up) but are defined here now so all tuning lives in one place.
export const config = {
  /** Save schema version (bumped when the persisted shape or item set changes). */
  saveVersion: 14,

  /** Simulation tick length in milliseconds (M3). */
  tickMs: 500,

  /** Stock-market update cadence in minutes (M7). */
  marketIntervalMinutes: 5,
  /** Market volatility: factor range is ×[1/(1+v), (1+v)] (M7). */
  volatility: 0.2,
  /**
   * Market crash band, expressed as multiples of each item's `startingValue`
   * (M7). A price crashes back to its starting value when it walks down to
   * `startingValue * crashFloorMultiple` or up to
   * `startingValue * crashCeilingMultiple`. Derived globally so items only need
   * a `startingValue` — see `priceBand()` in `src/game/market.ts`.
   */
  crashFloorMultiple: 0.5,
  crashCeilingMultiple: 2,

  /** Starting money for a new game (M6). */
  startingMoney: 0,

  /** Item id produced as the fallback "junk" output (M4). */
  junkItemId: 'junk',

  /**
   * Teleporter transit-queue capacity per channel. Send pads back-pressure (like
   * any full sink) once their channel holds this many in-transit items, so an
   * output that can't keep up — or a channel with no output pad at all — jams the
   * inputs instead of dropping items. See the teleporter block in `tick.ts`.
   */
  teleporterQueueCapacity: 32,

  /**
   * Village Hut recipe (villager production). The hut consumes one item matching
   * each input requirement — `food`/`drink` by item category, `bed` by exact id —
   * and emits `output`. Category-gated: a non-matching item on an input side is
   * rejected (it back-pressures) rather than being turned into junk.
   */
  villageRecipe: {
    food: 'food',
    drink: 'drink',
    bed: 'bed',
    output: 'villager',
  },

  /**
   * Per-villager economic effect when banked in a Town Hall. Each is a
   * per-unit rate applied to the summed population across all town halls (see
   * `computeTownModifiers` in `src/game/town.ts`):
   *  - villager  → generic sell-price boost (untyped, small)
   *  - merchant  → sell-price boost
   *  - guard     → market-volatility reduction (steadier prices)
   *  - innkeeper → offline-earnings boost
   *  - mason     → machine build-cost reduction
   *  - farmer    → higher crash ceiling for `food`
   *  - miner     → higher crash ceiling for `material`/`valuable`
   */
  townLevers: {
    villager: 0.005,
    merchant: 0.02,
    guard: 0.01,
    innkeeper: 0.05,
    mason: 0.01,
    farmer: 0.02,
    miner: 0.02,
  },
  /** Floors for the reduction levers, so they can't drive a factor to zero. */
  townLeverFloors: { volatility: 0.25, buildCost: 0.25 },
  /**
   * Diminishing returns on banked villagers. Each lever's strength scales with
   * `count ^ diminishingExponent` rather than `count`, so villagers are NOT
   * linearly stacking — the Nth villager is worth less than the first.
   *  - 1    → linear (every villager equally strong; the old behaviour)
   *  - 0.5  → square root: 1 villager unchanged, 2 give ×1.41, 4 to double 1
   *  - <0.5 → harsher falloff (approaches logarithmic feel)
   * Chosen so a single villager still matches its `townLevers` value exactly
   * (`1 ^ e = 1`), so those per-unit numbers keep their meaning at the margin.
   */
  townScaling: { diminishingExponent: 0.5 },

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
