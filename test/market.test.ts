import { describe, it, expect } from 'vitest'
import { catchUpMarket, seedMarket, stepMarket, type Market, HISTORY_LEN } from '../src/game/market'
import { ITEMS_BY_ID } from '../src/data'
import { config } from '../src/data/config'

const INTERVAL_MS = config.marketIntervalMinutes * 60_000

function oneItemMarket(id: string, price: number): Market {
  return { lastUpdate: 0, items: { [id]: { price, history: [price], crashed: false } } }
}

describe('stepMarket: neutral random walk', () => {
  it('leaves prices unchanged when rand()=0.5 (factor exp(0)=1)', () => {
    const before = seedMarket(0)
    const after = stepMarket(before, () => 0.5)
    for (const id of Object.keys(before.items)) {
      expect(after.items[id].price).toBe(before.items[id].price)
    }
  })

  it('is geometrically neutral: a down step then an up step restores the price', () => {
    const start = seedMarket(0)
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
  it('resets to the starting value when a price rises to maxPrice', () => {
    const def = ITEMS_BY_ID['ore'] // start 1, max 50
    const m = stepMarket(oneItemMarket('ore', def.maxPrice - 2), () => 1) // ×1.2 → over max
    expect(m.items['ore'].price).toBe(def.startingValue)
    expect(m.items['ore'].crashed).toBe(true)
  })

  it('resets to the starting value when a price falls to minPrice', () => {
    const def = ITEMS_BY_ID['ore'] // start 1, min 0.1
    const m = stepMarket(oneItemMarket('ore', def.minPrice + 0.01), () => 0) // ÷1.2 → under min
    expect(m.items['ore'].price).toBe(def.startingValue)
    expect(m.items['ore'].crashed).toBe(true)
  })
})

describe('catchUpMarket', () => {
  it('applies one step per whole elapsed interval and advances lastUpdate by whole intervals', () => {
    const start = seedMarket(0)
    const now = 3 * INTERVAL_MS + INTERVAL_MS / 2 // 3.5 intervals elapsed
    const m = catchUpMarket(start, now, () => 0.5)
    expect(m.items['ore'].history.length).toBe(1 + 3) // 3 steps applied
    expect(m.lastUpdate).toBe(3 * INTERVAL_MS) // remainder preserved
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
