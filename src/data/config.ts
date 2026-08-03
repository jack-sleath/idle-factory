import type { Camera } from '../render/camera'

// Single source of truth for tunable game configuration (see the NFRs). The
// world is unbounded, so there is deliberately no grid-size setting here.
// Per-item prices live in data/items.json; per-buildable costs in
// data/catalog.json. Some fields are consumed by later milestones (market,
// offline catch-up) but are defined here now so all tuning lives in one place.
export const config = {
  /** Save schema version (bumped when the persisted shape or item set changes). */
  saveVersion: 16,

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
  /**
   * Reduction levers (guard→volatility, mason→build cost) used to slam into a
   * hard floor: once `√N × rate` reached `1 - floor` the value was clamped and
   * every further villager did *nothing*. Now the floor is a soft **knee**: up
   * to that reduction the lever is unchanged (linear in the effective count),
   * and past the knee the reduction keeps growing but bends, approaching the
   * (much smaller) `townLeverAsymptotes` value without ever reaching it. So
   * builds are never free and the market is never perfectly frozen, but extra
   * guards/masons are never wasted — they always help a little more. See
   * `reductionMultiplier` in `town.ts`.
   */
  townLeverFloors: { volatility: 0.25, buildCost: 0.25 },
  /**
   * The true minimum multiplier each reduction lever asymptotically approaches
   * (but never reaches) once past its knee. Small = lots of head-room for a
   * huge villager count to keep mattering; strictly > 0 so cost/volatility can
   * never hit zero. Must be below the corresponding `townLeverFloors` value.
   */
  townLeverAsymptotes: { volatility: 0.02, buildCost: 0.02 },
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

  /**
   * Smoothly tween belt items between cells over each tick instead of snapping.
   * Purely cosmetic — the simulation is unchanged; the renderer interpolates each
   * item's position across `tickMs` by diffing consecutive item snapshots (see
   * `GameCanvas`). Automatically suppressed when the OS requests reduced motion.
   */
  animateItems: true,
  /**
   * Animate items through a processor/combiner/village hut: inputs glide onto the
   * machine as they arrive, the product spins and pops in as they fuse, then it
   * glides off onto the belt. Purely cosmetic (renderer-only, driven by the tick's
   * `produced` signal plus buffer diffs — see `GameCanvas`) and suppressed under
   * the OS reduced-motion preference.
   */
  animateMachines: true,
  /** Duration of the fuse-into-product spin in ms (kept under `tickMs`). */
  machineSpinMs: 450,

  /** Initial camera (world coord at viewport centre + pixels-per-cell). */
  camera: { x: 1, y: 0, zoom: 72 } as Camera,
  /** Zoom clamp (pixels per cell). */
  zoomMin: 24,
  zoomMax: 200,

  /** Cell span of a spatial chunk, used for viewport culling. */
  chunkSize: 16,

  /**
   * Daily challenges: a set of `boardSize` harder objectives drawn once per day
   * (each pays a one-time coin reward — see `src/game/bounties.ts`). The whole set
   * shares a deadline at the next local midnight; completing one banks its reward
   * and leaves it on the board marked done (no mid-day replacement), and the set
   * is redrawn at the daily reset. Rewards are deliberately a small garnish on
   * factory income (never a permanent multiplier), and the daily cadence keeps
   * that garnish small, so the board can't distort the tuned income/cost race.
   * `completedLogCap` bounds the persisted completed history.
   */
  bounties: { boardSize: 3, completedLogCap: 50 },
}

export type Config = typeof config
