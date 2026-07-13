import { basePrice, ITEMS, ITEMS_BY_ID } from '../data'
import { config } from '../data/config'

// Stock market (M7). Each item's price does a geometrically-neutral random walk:
// every `marketIntervalMinutes` it is multiplied by
//   exp((rand()*2 − 1) · ln(1 + volatility))
// which lands in ×[1/(1+v), (1+v)] and — because the log-factor is symmetric
// about 0 — has no systematic up/down drift over the long run. If a price falls
// to `minPrice` or rises to `maxPrice` it "crashes" back to its starting value.
// A rolling window of the last 10 prices feeds the panel's sparkline. The whole
// thing is time-driven (not tick-driven): on load we advance by however many
// intervals have elapsed, capped, so it also powers offline catch-up in M9.

/** Number of recent prices kept per item for the sparkline. */
export const HISTORY_LEN = 10

export interface MarketItem {
  price: number
  /** Most recent prices, oldest first, at most HISTORY_LEN entries. */
  history: number[]
  /** True for the interval immediately after a min/max crash reset. */
  crashed: boolean
}

export interface Market {
  /** Wall-clock ms of the last applied market step. */
  lastUpdate: number
  items: Record<string, MarketItem>
}

/** A source of randomness in [0, 1); injectable so the walk is testable. */
export type Rng = () => number

const intervalMs = () => config.marketIntervalMinutes * 60_000
const capMs = () => config.maxOfflineHours * 3_600_000

/**
 * A fresh market. Each item's current price is its starting value, but its
 * sparkline history is pre-seeded with a full HISTORY_LEN points from a neutral
 * random walk stepped *backwards* from that starting value — so a brand-new (or
 * freshly reset) market shows a real, moving chart instead of a flat line pinned
 * to the base value. The synthetic back-story is clamped to each item's
 * [minPrice, maxPrice] band (no crash resets) so it stays plausible; the newest
 * point — the live price — is left exactly at the starting value.
 */
export function seedMarket(now: number, rng: Rng = Math.random): Market {
  const lnBand = Math.log(1 + config.volatility)
  const items: Record<string, MarketItem> = {}
  for (const it of ITEMS) {
    // Walk backwards from the starting value, prepending older prices, so the
    // history ends (newest, last) exactly at `startingValue`.
    const history: number[] = [it.startingValue]
    let price = it.startingValue
    for (let i = 1; i < HISTORY_LEN; i++) {
      price *= Math.exp((rng() * 2 - 1) * lnBand)
      price = Math.min(Math.max(price, it.minPrice), it.maxPrice)
      history.unshift(price)
    }
    items[it.id] = { price: it.startingValue, history, crashed: false }
  }
  return { lastUpdate: now, items }
}

/**
 * Back-fill any item whose sparkline window holds fewer than HISTORY_LEN points
 * (e.g. a young save, or one from before pre-seeding existed) with synthetic
 * older prices, so every chart renders full instead of collapsing to a flat
 * base-value dot. Older points are walked backwards from the current oldest
 * entry with the same neutral step, clamped to each item's price band; the live
 * price and every real recorded point are left untouched. Items already at
 * HISTORY_LEN are returned unchanged, so a full market is a no-op (same
 * reference).
 */
export function fillHistory(market: Market, rng: Rng = Math.random): Market {
  const lnBand = Math.log(1 + config.volatility)
  let changed = false
  const items: Record<string, MarketItem> = {}
  for (const id of Object.keys(market.items)) {
    const item = market.items[id]
    if (item.history.length >= HISTORY_LEN) {
      items[id] = item
      continue
    }
    changed = true
    const def = ITEMS_BY_ID[id]
    const filler: number[] = []
    let price = item.history[0] ?? item.price
    for (let i = item.history.length; i < HISTORY_LEN; i++) {
      price *= Math.exp((rng() * 2 - 1) * lnBand)
      if (def) price = Math.min(Math.max(price, def.minPrice), def.maxPrice)
      filler.unshift(price) // older points accumulate in front, oldest first
    }
    items[id] = { ...item, history: [...filler, ...item.history] }
  }
  return changed ? { lastUpdate: market.lastUpdate, items } : market
}

/** Advance every price by one neutral random step, applying the crash rule. */
export function stepMarket(market: Market, rng: Rng): Market {
  const lnBand = Math.log(1 + config.volatility)
  const items: Record<string, MarketItem> = {}
  for (const id of Object.keys(market.items)) {
    const prev = market.items[id]
    const def = ITEMS_BY_ID[id]
    let price = prev.price * Math.exp((rng() * 2 - 1) * lnBand)
    let crashed = false
    if (def && (price <= def.minPrice || price >= def.maxPrice)) {
      price = def.startingValue // crash → reset to starting value
      crashed = true
    }
    const history = [...prev.history, price].slice(-HISTORY_LEN)
    items[id] = { price, history, crashed }
  }
  return { lastUpdate: market.lastUpdate, items }
}

/**
 * Apply all market steps due since `market.lastUpdate` at wall-clock `now`,
 * capped at `maxOfflineHours`. `lastUpdate` advances by whole intervals only, so
 * the sub-interval remainder is preserved for next time.
 */
export function catchUpMarket(market: Market, now: number, rng: Rng): Market {
  const elapsed = Math.min(Math.max(0, now - market.lastUpdate), capMs())
  const steps = Math.floor(elapsed / intervalMs())
  if (steps <= 0) return market
  let m = market
  for (let i = 0; i < steps; i++) m = stepMarket(m, rng)
  return { lastUpdate: market.lastUpdate + steps * intervalMs(), items: m.items }
}

/** The current sale price of an item (falls back to its base/starting price). */
export function livePrice(market: Market, itemId: string): number {
  return market.items[itemId]?.price ?? basePrice(itemId)
}

/** A plain `{ itemId: price }` snapshot, e.g. to hand to the tick engine. */
export function priceSnapshot(market: Market): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const id of Object.keys(market.items)) prices[id] = market.items[id].price
  return prices
}
