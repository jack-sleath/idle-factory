import { describe, it, expect } from 'vitest'
import { computeTownModifiers, sumVillagers, IDENTITY_TOWN_MODIFIERS } from '../src/game/town'
import type { TownHallState } from '../src/game/tick'
import { config } from '../src/data/config'

/** Build a town-halls map from a list of per-hall count records. */
function halls(...records: TownHallState[]): Map<string, TownHallState> {
  const m = new Map<string, TownHallState>()
  records.forEach((counts, i) => m.set(`${i},0`, counts))
  return m
}

const lv = config.townLevers

describe('town modifiers', () => {
  it('is the identity when there are no town halls', () => {
    expect(computeTownModifiers(new Map())).toBe(IDENTITY_TOWN_MODIFIERS)
  })

  it('merchants (and the small per-villager base) raise the sell multiplier', () => {
    const m = computeTownModifiers(halls({ merchant: 3, villager: 2 }))
    expect(m.sellMultiplier).toBeCloseTo(1 + 3 * lv.merchant + 2 * lv.villager, 10)
  })

  it('sums the population across every hall before applying a lever', () => {
    // Two halls each holding merchants → their effect adds up.
    const m = computeTownModifiers(halls({ merchant: 2 }, { merchant: 3 }))
    expect(m.sellMultiplier).toBeCloseTo(1 + 5 * lv.merchant, 10)
  })

  it('guards reduce volatility but never past the floor', () => {
    expect(computeTownModifiers(halls({ guard: 10 })).volatilityMultiplier).toBeCloseTo(
      1 - 10 * lv.guard,
      10,
    )
    // A huge guard count clamps at the configured floor rather than going ≤0.
    expect(computeTownModifiers(halls({ guard: 100000 })).volatilityMultiplier).toBe(
      config.townLeverFloors.volatility,
    )
  })

  it('farmers lift the food ceiling; miners lift material and valuable', () => {
    const m = computeTownModifiers(halls({ farmer: 4, miner: 5 }))
    expect(m.ceilingMultiplier.food).toBeCloseTo(1 + 4 * lv.farmer, 10)
    expect(m.ceilingMultiplier.material).toBeCloseTo(1 + 5 * lv.miner, 10)
    expect(m.ceilingMultiplier.valuable).toBeCloseTo(1 + 5 * lv.miner, 10)
  })

  it('sumVillagers totals ids across halls', () => {
    expect(sumVillagers(halls({ merchant: 2, guard: 1 }, { merchant: 1 }))).toEqual({
      merchant: 3,
      guard: 1,
    })
  })
})
