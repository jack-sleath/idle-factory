import { config } from '../data/config'
import type { TownHallState } from './tick'

// Town-hall economy modifiers. Villagers delivered to a town hall are banked by
// type (see the `townhall` machine in tick.ts); the global effect is derived
// from the SUM of every hall's banked counts. Keeping the modifiers *derived*
// (rather than stored) means the spec's rules fall out for free: deleting a hall
// drops its counts and its contribution, and multiple halls simply add up.

export interface TownModifiers {
  /** Multiplier on every sale price (≥1). Merchants + a small per-villager base. */
  sellMultiplier: number
  /** Multiplier on market volatility (≤1, floored). Guards steady prices. */
  volatilityMultiplier: number
  /** Multiplier on offline earnings (≥1). Innkeepers. */
  offlineMultiplier: number
  /** Multiplier on machine build cost (≤1, floored). Masons. */
  buildCostMultiplier: number
  /** Per-category crash-ceiling multiplier (≥1); missing categories mean ×1. */
  ceilingMultiplier: Record<string, number>
}

/** No town halls (or an empty one) → every lever is a no-op. */
export const IDENTITY_TOWN_MODIFIERS: TownModifiers = {
  sellMultiplier: 1,
  volatilityMultiplier: 1,
  offlineMultiplier: 1,
  buildCostMultiplier: 1,
  ceilingMultiplier: {},
}

/**
 * Diminishing-returns transform applied to a banked villager count before it
 * drives a lever. With `config.townScaling.diminishingExponent < 1` villagers
 * stop stacking linearly — two are worth less than twice one — which keeps the
 * compounding levers (sell/offline) from running away as counts grow. A single
 * villager is left unchanged (`1 ^ e = 1`), so the `townLevers` values keep
 * their meaning as the per-first-villager rate.
 */
export function effectiveVillagers(count: number): number {
  return Math.pow(Math.max(0, count), config.townScaling.diminishingExponent)
}

/**
 * Multiplier for a *reduction* lever (guard→volatility, mason→build cost).
 *
 * The reduction (`1 - multiplier`) grows linearly at `rate` per effective
 * villager — exactly the old behaviour — until it reaches the soft knee
 * (`1 - knee`). Past the knee it keeps growing but bends, approaching a maximum
 * reduction of `1 - asymptote` without ever reaching it, and the join is
 * C¹-continuous (same slope on both sides), so there's no visible kink. The
 * returned multiplier therefore falls from 1 toward `asymptote` and never hits
 * 0: builds are never free and the market is never perfectly frozen, yet every
 * extra villager still helps a little — nothing past the old cap is wasted.
 */
export function reductionMultiplier(
  effCount: number,
  rate: number,
  knee: number,
  asymptote: number,
): number {
  const linear = Math.max(0, effCount) * rate
  const kneeReduction = 1 - knee
  const maxReduction = 1 - asymptote
  // Below the knee (or if misconfigured so there's no head-room): pure linear,
  // clamped to the asymptote so it can never cross it.
  if (linear <= kneeReduction || maxReduction <= kneeReduction) {
    return 1 - Math.min(linear, maxReduction)
  }
  const span = maxReduction - kneeReduction
  const reduction = maxReduction - span * Math.exp(-(linear - kneeReduction) / span)
  return 1 - reduction
}

/** Sum banked villagers across every town hall, keyed by villager item id. */
export function sumVillagers(townHalls: Map<string, TownHallState>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const hall of townHalls.values()) {
    for (const [id, n] of Object.entries(hall)) totals[id] = (totals[id] ?? 0) + n
  }
  return totals
}

/** Derive the global economy modifiers from the summed town-hall population. */
export function computeTownModifiers(townHalls: Map<string, TownHallState>): TownModifiers {
  if (townHalls.size === 0) return IDENTITY_TOWN_MODIFIERS
  const totals = sumVillagers(townHalls)
  const lv = config.townLevers
  // `n(id)` is the *effective* count after diminishing returns, not the raw
  // tally — so every lever below inherits the non-linear scaling for free.
  const n = (id: string) => effectiveVillagers(totals[id] ?? 0)
  return {
    sellMultiplier: 1 + n('merchant') * lv.merchant + n('villager') * lv.villager,
    volatilityMultiplier: reductionMultiplier(
      n('guard'),
      lv.guard,
      config.townLeverFloors.volatility,
      config.townLeverAsymptotes.volatility,
    ),
    offlineMultiplier: 1 + n('innkeeper') * lv.innkeeper,
    buildCostMultiplier: reductionMultiplier(
      n('mason'),
      lv.mason,
      config.townLeverFloors.buildCost,
      config.townLeverAsymptotes.buildCost,
    ),
    ceilingMultiplier: {
      food: 1 + n('farmer') * lv.farmer,
      material: 1 + n('miner') * lv.miner,
      valuable: 1 + n('miner') * lv.miner,
    },
  }
}
