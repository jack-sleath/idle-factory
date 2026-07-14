import type { Machine } from './types'
import { step, type SimState, type StorageState } from './tick'
import { catchUpMarket, livePrice, type Market, type Rng } from './market'
import { storageCapacity } from '../data'
import { config } from '../data/config'
import { cellKey, dirDelta } from './world'

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

  // Extrapolate storage per CHAIN, not per isolated storage. When storages are
  // chained (one facing directly into another), the upstream ones are pass-through
  // during the sample: they receive and immediately re-emit downstream, so their
  // net delta is ~0 and only the tail shows accrual. Extrapolating each in
  // isolation would leave every upstream chest empty (bug: "only the second one
  // fills"). Instead we sum the sampled net delta across each chain — that sum is
  // the whole chain's true intake rate (internal hand-offs cancel) — then fill the
  // chain from its downstream tail backward, letting overflow back up into the
  // upstream chests exactly as back-pressure would over the real elapsed time.
  const nextStores = new Map(input.stores)
  const stockpiledByItem: Record<string, number> = {}

  const storageKeys: string[] = []
  for (const [key, m] of input.machines) if (m.kind === 'storage') storageKeys.push(key)

  const sampledDelta = (key: string) =>
    (sim.stores.get(key)?.count ?? 0) - (baseStore.get(key) ?? 0)

  // Directed edge key→downstream: a storage feeds the storage directly ahead of
  // its facing side (that is the side it offers its stockpile out of).
  const downstream = new Map<string, string>()
  for (const key of storageKeys) {
    const m = input.machines.get(key)!
    const { dx, dy } = dirDelta(m.dir)
    const target = cellKey(m.x + dx, m.y + dy)
    if (input.machines.get(target)?.kind === 'storage') downstream.set(key, target)
  }

  // Group storages into connected chains (treating the feed edges as undirected).
  const chainOf = new Map<string, number>()
  const chains: string[][] = []
  for (const key of storageKeys) {
    if (chainOf.has(key)) continue
    const id = chains.length
    const members: string[] = []
    const queue = [key]
    chainOf.set(key, id)
    while (queue.length) {
      const cur = queue.pop()!
      members.push(cur)
      const neighbours = [downstream.get(cur)]
      for (const [from, to] of downstream) if (to === cur) neighbours.push(from)
      for (const nb of neighbours) {
        if (nb && !chainOf.has(nb)) {
          chainOf.set(nb, id)
          queue.push(nb)
        }
      }
    }
    chains.push(members)
  }

  for (const members of chains) {
    // The chain's net intake = sum of member deltas (internal transfers cancel).
    let deltaSum = 0
    let sampledItem: string | null = null
    for (const key of members) {
      deltaSum += sampledDelta(key)
      sampledItem = sampledItem ?? sim.stores.get(key)?.item ?? null
    }
    if (deltaSum <= 0 || sampledItem == null) continue
    let remaining = Math.floor((deltaSum / sampleMs) * elapsed)
    if (remaining <= 0) continue

    // Fill downstream-tail first, then upstream: physically items reach the tail
    // and only back up once it is full. Order = reverse-topological (a member goes
    // before the member it feeds is impossible, so tails — whose downstream is
    // outside the chain — come first, walking upstream via the reverse edges).
    const pending = new Set(members)
    const order: string[] = []
    while (pending.size) {
      let progressed = false
      for (const key of pending) {
        const down = downstream.get(key)
        if (down == null || !pending.has(down)) {
          order.push(key)
          pending.delete(key)
          progressed = true
        }
      }
      if (!progressed) {
        // Cyclic layout (chests facing each other): fall back to arbitrary order.
        for (const key of pending) order.push(key)
        pending.clear()
      }
    }

    for (const key of order) {
      const real = input.stores.get(key)
      if (real?.item != null && real.item !== sampledItem) continue // locked to another type
      const capacity = storageCapacity(input.machines.get(key)?.catalogId ?? '')
      const current = real?.count ?? 0
      const room = Math.max(0, capacity - current)
      const gained = Math.min(remaining, room)
      if (gained <= 0) continue
      nextStores.set(key, { item: sampledItem, count: current + gained })
      stockpiledByItem[sampledItem] = (stockpiledByItem[sampledItem] ?? 0) + gained
      remaining -= gained
      if (remaining <= 0) break
    }
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
