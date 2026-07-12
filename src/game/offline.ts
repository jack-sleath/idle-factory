import type { Machine } from './types'
import { step, type SimState, type StorageState } from './tick'
import { catchUpMarket, livePrice, type Market, type Rng } from './market'
import { storageCapacity } from '../data'
import { config } from '../data/config'

// Offline idle progression (M9). While the tab/browser is closed the factory
// should keep stockpiling (and auto-sellers keep earning), but we must not
// replay a day of ticks. Instead we SAMPLE a short steady-state window headlessly
// (with selling switched off so sellers buffer) to measure each storage's and
// seller's intake rate, then LINEARLY EXTRAPOLATE that rate over the elapsed
// offline time (capped). This is O(sample) work regardless of how long we were
// away, so catch-up is near-instant even after a full day.

export interface AwaySummary {
  elapsedMs: number
  /** Items added to storage while away, aggregated by item type. */
  stockpiled: { item: string; count: number }[]
  /** Money auto-earned from seller buffers, sold once at the caught-up price. */
  earned: number
}

export interface OfflineResult {
  stores: Map<string, StorageState>
  market: Market
  money: number
  summary: AwaySummary
}

export interface OfflineInput {
  machines: Map<string, Machine>
  stores: Map<string, StorageState>
  market: Market
  money: number
  savedAt: number
}

const MS_PER_HOUR = 3_600_000

/** Compute the state after being away from `savedAt` until `now`. Pure. */
export function computeOffline(input: OfflineInput, now: number, rng: Rng): OfflineResult {
  const capMs = config.maxOfflineHours * MS_PER_HOUR
  const elapsed = Math.min(Math.max(0, now - input.savedAt), capMs)

  // Market advances by the same capped elapsed window (catchUpMarket is bounded
  // by maxOfflineHours too), and is used for the caught-up selling price below.
  const market = catchUpMarket(input.market, now, rng)

  const tickMs = config.tickMs
  const sampleTicks = Math.max(1, Math.round((config.offlineSampleSeconds * 1000) / tickMs))
  const warmupTicks = Math.max(0, Math.round((config.offlineWarmupSeconds * 1000) / tickMs))
  const sampleMs = sampleTicks * tickMs

  // Headless sample: sellers offline (buffering), storages emptied so we measure
  // the free arrival rate rather than a rate throttled by an already-full store.
  let sim: SimState = {
    machines: input.machines,
    items: new Map(),
    buffers: new Map(),
    stores: new Map(),
    sellerBuffers: new Map(),
    money: 0,
    prices: {},
    online: false,
    tick: 0,
  }
  for (let i = 0; i < warmupTicks; i++) sim = step(sim)

  const baseStore = new Map<string, number>()
  for (const [key, st] of sim.stores) baseStore.set(key, st.count)
  const baseSeller = new Map<string, Record<string, number>>()
  for (const [key, buf] of sim.sellerBuffers) baseSeller.set(key, { ...buf })

  for (let i = 0; i < sampleTicks; i++) sim = step(sim)

  // Extrapolate storage: each storage gains rate×elapsed, clamped to the real
  // remaining capacity and only when the sampled item matches its lock.
  const nextStores = new Map(input.stores)
  const stockpiledByItem: Record<string, number> = {}
  for (const [key, st] of sim.stores) {
    const delta = st.count - (baseStore.get(key) ?? 0)
    if (delta <= 0 || !st.item) continue
    const real = input.stores.get(key)
    if (real?.item != null && real.item !== st.item) continue // locked to another type
    const capacity = storageCapacity(input.machines.get(key)?.catalogId ?? '')
    const current = real?.count ?? 0
    const room = Math.max(0, capacity - current)
    const gained = Math.min(Math.floor((delta / sampleMs) * elapsed), room)
    if (gained <= 0) continue
    const item = real?.item ?? st.item
    nextStores.set(key, { item, count: current + gained })
    stockpiledByItem[item] = (stockpiledByItem[item] ?? 0) + gained
  }

  // Extrapolate sellers: sell the extrapolated buffer once at the caught-up price.
  let earned = 0
  for (const [key, buf] of sim.sellerBuffers) {
    const base = baseSeller.get(key) ?? {}
    for (const item of Object.keys(buf)) {
      const delta = buf[item] - (base[item] ?? 0)
      if (delta <= 0) continue
      earned += (delta / sampleMs) * elapsed * livePrice(market, item)
    }
  }

  const stockpiled = Object.entries(stockpiledByItem).map(([item, count]) => ({ item, count }))
  return {
    stores: nextStores,
    market,
    money: input.money + earned,
    summary: { elapsedMs: elapsed, stockpiled, earned },
  }
}
