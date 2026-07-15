import { basePrice, ITEMS, ITEMS_BY_ID } from '../data'
import { config } from '../data/config'
import type { ItemDef } from './types'
import { IDENTITY_TOWN_MODIFIERS, type TownModifiers } from './town'

// Stock market (M7). Each item's price does a geometrically-neutral random walk:
// every `marketIntervalMinutes` it is multiplied by
//   exp((rand()*2 − 1) · ln(1 + volatility))
// which lands in ×[1/(1+v), (1+v)] and — because the log-factor is symmetric
// about 0 — has no systematic up/down drift over the long run. Each item's
// crash band is derived from its `startingValue` times the global
// `crashFloor/CeilingMultiple` knobs (see `priceBand()`); if a price walks down
// to the floor or up to the ceiling it "crashes" back to its starting value.
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
 * The crash band `[min, max]` for an item, derived from its `startingValue`
 * times the global `crashFloor/CeilingMultiple` knobs. Town-hall farmers/miners
 * can raise the ceiling for a whole category via `modifiers.ceilingMultiplier`.
 * A price that walks to or past either edge crashes back to `startingValue`.
 */
export function priceBand(
  def: Pick<ItemDef, 'startingValue' | 'category'>,
  modifiers: TownModifiers = IDENTITY_TOWN_MODIFIERS,
): { min: number; max: number } {
  const ceilingBoost = modifiers.ceilingMultiplier[def.category] ?? 1
  return {
    min: def.startingValue * config.crashFloorMultiple,
    max: def.startingValue * config.crashCeilingMultiple * ceilingBoost,
  }
}

/**
 * A fresh market. Each item's sparkline history is pre-seeded with a full
 * HISTORY_LEN points from a neutral random walk stepped *forwards* from its
 * starting value — so a brand-new (or freshly reset) market shows a real, moving
 * chart instead of a flat line pinned to the base value. The oldest point is the
 * `startingValue`; the newest point — and the live current price — is the
 * endpoint of that walk, i.e. what the price would be if those steps had
 * actually elapsed. The synthetic history is clamped to each item's crash band
 * (see `priceBand()`, no crash resets) so it stays plausible.
 */
export function seedMarket(now: number, rng: Rng = Math.random): Market {
  const lnBand = Math.log(1 + config.volatility)
  const items: Record<string, MarketItem> = {}
  for (const it of ITEMS) {
    // Walk forwards from the starting value, appending newer prices, so the
    // history begins (oldest, first) at `startingValue` and ends (newest, last)
    // at the walked price, which is also the live current price.
    const history: number[] = [it.startingValue]
    const band = priceBand(it)
    let price = it.startingValue
    for (let i = 1; i < HISTORY_LEN; i++) {
      price *= Math.exp((rng() * 2 - 1) * lnBand)
      price = Math.min(Math.max(price, band.min), band.max)
      history.push(price)
    }
    items[it.id] = { price, history, crashed: false }
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
    const band = def ? priceBand(def) : null
    const filler: number[] = []
    let price = item.history[0] ?? item.price
    for (let i = item.history.length; i < HISTORY_LEN; i++) {
      price *= Math.exp((rng() * 2 - 1) * lnBand)
      if (band) price = Math.min(Math.max(price, band.min), band.max)
      filler.unshift(price) // older points accumulate in front, oldest first
    }
    items[id] = { ...item, history: [...filler, ...item.history] }
  }
  return changed ? { lastUpdate: market.lastUpdate, items } : market
}

/**
 * Advance every price by one neutral random step, applying the crash rule.
 * Town-hall guards shrink the step (lower volatility) and farmers/miners lift
 * the crash ceiling per category, both via `modifiers`.
 */
export function stepMarket(
  market: Market,
  rng: Rng,
  modifiers: TownModifiers = IDENTITY_TOWN_MODIFIERS,
): Market {
  const lnBand = Math.log(1 + config.volatility * modifiers.volatilityMultiplier)
  const items: Record<string, MarketItem> = {}
  for (const id of Object.keys(market.items)) {
    const prev = market.items[id]
    const def = ITEMS_BY_ID[id]
    let price = prev.price * Math.exp((rng() * 2 - 1) * lnBand)
    let crashed = false
    if (def) {
      const band = priceBand(def, modifiers)
      if (price <= band.min || price >= band.max) {
        price = def.startingValue // crash → reset to starting value
        crashed = true
      }
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
export function catchUpMarket(
  market: Market,
  now: number,
  rng: Rng,
  modifiers: TownModifiers = IDENTITY_TOWN_MODIFIERS,
): Market {
  const elapsed = Math.min(Math.max(0, now - market.lastUpdate), capMs())
  const steps = Math.floor(elapsed / intervalMs())
  if (steps <= 0) return market
  let m = market
  for (let i = 0; i < steps; i++) m = stepMarket(m, rng, modifiers)
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
