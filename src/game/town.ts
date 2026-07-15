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
  const floorAt = (value: number, floor: number) => Math.max(floor, value)
  return {
    sellMultiplier: 1 + n('merchant') * lv.merchant + n('villager') * lv.villager,
    volatilityMultiplier: floorAt(1 - n('guard') * lv.guard, config.townLeverFloors.volatility),
    offlineMultiplier: 1 + n('innkeeper') * lv.innkeeper,
    buildCostMultiplier: floorAt(1 - n('mason') * lv.mason, config.townLeverFloors.buildCost),
    ceilingMultiplier: {
      food: 1 + n('farmer') * lv.farmer,
      material: 1 + n('miner') * lv.miner,
      valuable: 1 + n('miner') * lv.miner,
    },
  }
}
