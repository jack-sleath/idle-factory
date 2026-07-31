import { describe, it, expect } from 'vitest'
import {
  computeTownModifiers,
  effectiveVillagers,
  sumVillagers,
  IDENTITY_TOWN_MODIFIERS,
} from '../src/game/town'
import type { TownHallState } from '../src/game/tick'
import { config } from '../src/data/config'

/** Build a town-halls map from a list of per-hall count records. */
function halls(...records: TownHallState[]): Map<string, TownHallState> {
  const m = new Map<string, TownHallState>()
  records.forEach((counts, i) => m.set(`${i},0`, counts))
  return m
}

const lv = config.townLevers
/** Effective count after diminishing returns (mirrors town.ts). */
const eff = (n: number) => effectiveVillagers(n)

describe('town modifiers', () => {
  it('is the identity when there are no town halls', () => {
    expect(computeTownModifiers(new Map())).toBe(IDENTITY_TOWN_MODIFIERS)
  })

  it('merchants (and the small per-villager base) raise the sell multiplier', () => {
    const m = computeTownModifiers(halls({ merchant: 3, villager: 2 }))
    expect(m.sellMultiplier).toBeCloseTo(1 + eff(3) * lv.merchant + eff(2) * lv.villager, 10)
  })

  it('sums the population across every hall before applying a lever', () => {
    // Two halls each holding merchants → their effect adds up (then diminishes).
    const m = computeTownModifiers(halls({ merchant: 2 }, { merchant: 3 }))
    expect(m.sellMultiplier).toBeCloseTo(1 + eff(5) * lv.merchant, 10)
  })

  it('guards reduce volatility linearly below the knee', () => {
    // Small counts keep the exact old linear behaviour (well under the knee).
    expect(computeTownModifiers(halls({ guard: 10 })).volatilityMultiplier).toBeCloseTo(
      1 - eff(10) * lv.guard,
      10,
    )
  })

  it('reduction levers soften past the knee but never cap or hit zero', () => {
    const asym = config.townLeverAsymptotes.volatility
    // Far past the old hard cap, extra guards STILL help a little more...
    const big = computeTownModifiers(halls({ guard: 100000 })).volatilityMultiplier
    const bigger = computeTownModifiers(halls({ guard: 400000 })).volatilityMultiplier
    expect(bigger).toBeLessThan(big)
    // ...but the multiplier never dips to (or below) the asymptote: the market
    // is never perfectly frozen and build cost is never free.
    expect(big).toBeGreaterThan(asym)
    expect(bigger).toBeGreaterThan(asym)
    // The knee join is continuous: approaching it from below matches the old
    // linear value (no visible jump).
    const kneeReduction = 1 - config.townLeverFloors.volatility
    const atKnee = computeTownModifiers(
      halls({ guard: Math.round((kneeReduction / lv.guard) ** 2) }),
    ).volatilityMultiplier
    expect(atKnee).toBeCloseTo(config.townLeverFloors.volatility, 2)
  })

  it('farmers lift the food ceiling; miners lift material and valuable', () => {
    const m = computeTownModifiers(halls({ farmer: 4, miner: 5 }))
    expect(m.ceilingMultiplier.food).toBeCloseTo(1 + eff(4) * lv.farmer, 10)
    expect(m.ceilingMultiplier.material).toBeCloseTo(1 + eff(5) * lv.miner, 10)
    expect(m.ceilingMultiplier.valuable).toBeCloseTo(1 + eff(5) * lv.miner, 10)
  })

  it('sumVillagers totals ids across halls', () => {
    expect(sumVillagers(halls({ merchant: 2, guard: 1 }, { merchant: 1 }))).toEqual({
      merchant: 3,
      guard: 1,
    })
  })

  it('villagers give diminishing returns: two are worth less than twice one', () => {
    const one = computeTownModifiers(halls({ merchant: 1 })).sellMultiplier - 1
    const two = computeTownModifiers(halls({ merchant: 2 })).sellMultiplier - 1
    const four = computeTownModifiers(halls({ merchant: 4 })).sellMultiplier - 1
    // One merchant still equals its raw lever value (1 ^ e = 1).
    expect(one).toBeCloseTo(lv.merchant, 10)
    // Two are strictly more than one, but strictly less than double.
    expect(two).toBeGreaterThan(one)
    expect(two).toBeLessThan(2 * one)
    // With the default square-root curve it takes four to double the first.
    if (config.townScaling.diminishingExponent === 0.5) {
      expect(four).toBeCloseTo(2 * one, 10)
    }
  })

  it('effectiveVillagers is monotonic, concave, and pinned at 0 and 1', () => {
    expect(effectiveVillagers(0)).toBe(0)
    expect(effectiveVillagers(1)).toBe(1)
    // Concave: the jump from 1→2 is smaller than 0→1.
    expect(effectiveVillagers(2) - effectiveVillagers(1)).toBeLessThan(
      effectiveVillagers(1) - effectiveVillagers(0),
    )
  })
})
