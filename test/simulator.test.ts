import { describe, it, expect } from 'vitest'
import {
  buildProductionModel,
  simulate,
  PRESET_PROFILES,
  type PlayerProfile,
} from '../src/game/simulator'

const seller: PlayerProfile = {
  name: 'test seller',
  sessionMinutes: 15,
  sessionsPerDay: 3,
  machinesPerMinute: 12,
  buffInvestmentFraction: 0,
}
const buffer: PlayerProfile = { ...seller, name: 'test buffs', buffInvestmentFraction: 0.5 }

describe('production model', () => {
  it('derives sell lines, buff lines and the ore bootstrap', () => {
    const m = buildProductionModel()
    expect(m.sellLines.length).toBeGreaterThan(0)
    expect(m.sellLines.every((l) => l.incomePerTick > 0 && l.baseCost > 0 && l.machineCount > 0)).toBe(true)
    // Every villager specialist should be a derivable buff line.
    for (const type of ['villager', 'merchant', 'innkeeper', 'mason']) {
      expect(m.buffLines[type]).toBeDefined()
      expect(m.buffLines[type].ratePerTick).toBeGreaterThan(0)
    }
    expect(m.bootstrap.item).toBe('ore')
  })

  it('a longer chain costs more machines to lay down', () => {
    const m = buildProductionModel()
    const ore = m.sellLines.find((l) => l.item === 'ore')!
    const villager = m.buffLines['villager']
    expect(villager.machineCount).toBeGreaterThan(ore.machineCount)
  })
})

describe('simulation', () => {
  it('runs, grows money, and unlocks the expensive spawners', () => {
    const r = simulate(seller, { days: 30 })
    expect(r.samples.length).toBeGreaterThan(0)
    expect(r.finalNetWorth).toBeGreaterThan(0)
    expect(r.finalIncomePerTick).toBeGreaterThan(0)
    // A regular seller reaches the priciest spawner (the "end game") within a month.
    expect(r.endGameDay).not.toBeNull()
    expect(r.endGameDay!).toBeLessThanOrEqual(30)
  })

  it('is deterministic', () => {
    const a = simulate(seller, { days: 30 })
    const b = simulate(seller, { days: 30 })
    expect(b.finalNetWorth).toBe(a.finalNetWorth)
    expect(b.endGameDay).toBe(a.endGameDay)
  })

  it('a more frequent player reaches the end game no later', () => {
    const casual = simulate({ ...seller, sessionsPerDay: 1, sessionMinutes: 10 }, { days: 30 })
    const hardcore = simulate({ ...seller, sessionsPerDay: 6, sessionMinutes: 30 }, { days: 30 })
    expect(hardcore.endGameDay!).toBeLessThanOrEqual(casual.endGameDay!)
  })

  it('buff investment banks villagers and lifts the sell multiplier; pure sellers do neither', () => {
    const s = simulate(seller, { days: 30 })
    const b = simulate(buffer, { days: 30 })
    expect(s.finalModifiers.sellMultiplier).toBe(1)
    expect(Object.keys(s.bankedVillagers)).toHaveLength(0)
    expect(b.finalModifiers.sellMultiplier).toBeGreaterThan(1)
    expect(Object.values(b.bankedVillagers).reduce((a, n) => a + n, 0)).toBeGreaterThan(0)
  })

  it('cheaper end-game spawners are reached sooner (tuning sensitivity)', () => {
    const casual: PlayerProfile = { ...seller, sessionsPerDay: 1, sessionMinutes: 10 }
    const base = simulate(casual, { days: 30 })
    const cheap = simulate(casual, { days: 30, overrides: { cost: { 'diamond-deposit': 1 } } })
    expect(cheap.endGameDay!).toBeLessThanOrEqual(base.endGameDay!)
  })

  it('every preset profile runs without error', () => {
    for (const p of PRESET_PROFILES) {
      const r = simulate(p, { days: 30 })
      expect(Number.isFinite(r.finalNetWorth)).toBe(true)
      expect(r.samples.length).toBeGreaterThan(0)
    }
  })
})
