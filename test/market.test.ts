import { describe, it, expect } from 'vitest'
import { catchUpMarket, fillHistory, priceBand, seedMarket, stepMarket, type Market, HISTORY_LEN } from '../src/game/market'
import { ITEMS_BY_ID } from '../src/data'
import { config } from '../src/data/config'

const INTERVAL_MS = config.marketIntervalMinutes * 60_000

function oneItemMarket(id: string, price: number): Market {
  return { lastUpdate: 0, items: { [id]: { price, history: [price], crashed: false } } }
}

describe('seedMarket: pre-seeded history', () => {
  it('fills a full HISTORY_LEN sparkline window so it is not a flat base-value line', () => {
    const m = seedMarket(0, () => 0.25) // biased-low but non-neutral rng → real movement
    for (const id of Object.keys(m.items)) {
      const it = m.items[id]
      expect(it.history.length).toBe(HISTORY_LEN)
      expect(it.crashed).toBe(false)
      // The oldest point is the starting value; the newest point (live price)
      // is the endpoint of the forward walk…
      expect(it.history[0]).toBe(ITEMS_BY_ID[id].startingValue)
      expect(it.history[it.history.length - 1]).toBe(it.price)
      // …and the window as a whole moves, so the sparkline is not flat.
      expect(new Set(it.history).size).toBeGreaterThan(1)
    }
  })

  it('sets the current price to the endpoint of the seeding walk, not the base value', () => {
    // A biased-low rng makes every step a drop, so the walked price ends
    // strictly below the starting value rather than pinned to it.
    const m = seedMarket(0, () => 0.25)
    const start = ITEMS_BY_ID['ore'].startingValue
    expect(m.items['ore'].price).toBeLessThan(start)
    expect(m.items['ore'].price).toBe(m.items['ore'].history[HISTORY_LEN - 1])
  })

  it('clamps synthetic back-story within each item price band', () => {
    const m = seedMarket(0) // default rng; run the walk against real bounds
    for (const id of Object.keys(m.items)) {
      const band = priceBand(ITEMS_BY_ID[id])
      for (const p of m.items[id].history) {
        expect(p).toBeGreaterThanOrEqual(band.min)
        expect(p).toBeLessThanOrEqual(band.max)
      }
    }
  })
})

describe('fillHistory: back-fill short windows', () => {
  it('grows a short history to a full HISTORY_LEN window, preserving real points', () => {
    const m: Market = { lastUpdate: 7, items: { ore: { price: 3, history: [2, 3], crashed: false } } }
    const f = fillHistory(m, () => 0.5)
    expect(f.items['ore'].history.length).toBe(HISTORY_LEN)
    expect(f.lastUpdate).toBe(7)
    // The original recorded points stay at the newest (right) end, in order.
    expect(f.items['ore'].history.slice(-2)).toEqual([2, 3])
    expect(f.items['ore'].price).toBe(3) // live price untouched
  })

  it('is a no-op (same reference) when every item is already full', () => {
    const full = seedMarket(0)
    expect(fillHistory(full)).toBe(full)
  })

  it('clamps back-filled points to the item price band', () => {
    const def = ITEMS_BY_ID['ore']
    const m: Market = { lastUpdate: 0, items: { ore: { price: def.startingValue, history: [def.startingValue], crashed: false } } }
    const f = fillHistory(m) // default rng against real bounds
    const band = priceBand(def)
    for (const p of f.items['ore'].history) {
      expect(p).toBeGreaterThanOrEqual(band.min)
      expect(p).toBeLessThanOrEqual(band.max)
    }
  })
})

describe('stepMarket: neutral random walk', () => {
  it('leaves prices unchanged when rand()=0.5 (factor exp(0)=1)', () => {
    const before = seedMarket(0, () => 0.5) // neutral seed → prices at startingValue
    const after = stepMarket(before, () => 0.5)
    for (const id of Object.keys(before.items)) {
      expect(after.items[id].price).toBe(before.items[id].price)
    }
  })

  it('is geometrically neutral: a down step then an up step restores the price', () => {
    const start = seedMarket(0, () => 0.5) // neutral seed → prices at startingValue
    const down = stepMarket(start, () => 0) // factor 1/(1+v)
    const back = stepMarket(down, () => 1) // factor (1+v)
    for (const id of Object.keys(start.items)) {
      expect(back.items[id].price).toBeCloseTo(start.items[id].price, 10)
    }
  })

  it('keeps only the last HISTORY_LEN prices', () => {
    let m = seedMarket(0)
    for (let i = 0; i < HISTORY_LEN + 5; i++) m = stepMarket(m, () => 0.5)
    for (const id of Object.keys(m.items)) {
      expect(m.items[id].history.length).toBe(HISTORY_LEN)
    }
  })
})

describe('stepMarket: crash rule', () => {
  it('resets to the starting value when a price rises to the ceiling', () => {
    const def = ITEMS_BY_ID['ore'] // start 1 → band [0.5, 2]
    const band = priceBand(def)
    const m = stepMarket(oneItemMarket('ore', band.max - 0.01), () => 1) // ×1.2 → over ceiling
    expect(m.items['ore'].price).toBe(def.startingValue)
    expect(m.items['ore'].crashed).toBe(true)
  })

  it('resets to the starting value when a price falls to the floor', () => {
    const def = ITEMS_BY_ID['ore'] // start 1 → band [0.5, 2]
    const band = priceBand(def)
    const m = stepMarket(oneItemMarket('ore', band.min + 0.01), () => 0) // ÷1.2 → under floor
    expect(m.items['ore'].price).toBe(def.startingValue)
    expect(m.items['ore'].crashed).toBe(true)
  })

  it('derives the band from startingValue × the global crash multiples', () => {
    const def = ITEMS_BY_ID['ore']
    expect(priceBand(def)).toEqual({
      min: def.startingValue * config.crashFloorMultiple,
      max: def.startingValue * config.crashCeilingMultiple,
    })
  })
})

describe('catchUpMarket', () => {
  it('applies one step per whole elapsed interval and advances lastUpdate by whole intervals', () => {
    const start = seedMarket(0)
    const now = 3 * INTERVAL_MS + INTERVAL_MS / 2 // 3.5 intervals elapsed
    const m = catchUpMarket(start, now, () => 0.5)
    expect(m.items['ore'].history.length).toBe(HISTORY_LEN) // pre-seeded window stays full
    expect(m.lastUpdate).toBe(3 * INTERVAL_MS) // 3 whole steps applied; remainder preserved
  })

  it('is a no-op (same reference) when less than one interval has elapsed', () => {
    const start = seedMarket(0)
    expect(catchUpMarket(start, INTERVAL_MS - 1, () => 0.5)).toBe(start)
  })

  it('caps elapsed time at maxOfflineHours', () => {
    const start = seedMarket(0)
    const twoDays = 48 * 3_600_000
    const cappedSteps = Math.floor((config.maxOfflineHours * 3_600_000) / INTERVAL_MS)
    const m = catchUpMarket(start, twoDays, () => 0.5)
    expect(m.lastUpdate).toBe(cappedSteps * INTERVAL_MS)
    expect(m.items['ore'].history.length).toBe(HISTORY_LEN) // capped history
  })
})
