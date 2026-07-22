import type { Dir, Machine } from './types'
import { step, type SimState, type StorageState } from './tick'
import { catchUpMarket, livePrice, type Market, type Rng } from './market'
import { IDENTITY_TOWN_MODIFIERS, type TownModifiers } from './town'
import { CATALOG_BY_ID, storageCapacity } from '../data'
import { config } from '../data/config'
import { cellKey, dirDelta, nextDir } from './world'

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
  /** Town-hall economy modifiers (sell/offline boosts, market volatility). */
  modifiers?: TownModifiers
}

const MS_PER_HOUR = 3_600_000

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/** A combiner's two input sides, given its output direction. Mirrors tick.ts. */
function combinerInputDirs(dir: Dir): [Dir, Dir] {
  return dir === 'E' || dir === 'W' ? ['N', 'S'] : ['E', 'W']
}

/** The sides a machine offers items out of. Mirrors tick.ts movement rules. */
function outputDirs(m: Machine): Dir[] {
  if (m.kind === 'seller' || m.kind === 'townhall') return []
  // A send pad consumes into its channel (no adjacent output); a receive pad emits
  // out its facing. Storage-chain tracing therefore stops at a teleporter — the
  // two sides are traced as separate chains (a safe, conservative approximation).
  if (m.kind === 'teleporter') return CATALOG_BY_ID[m.catalogId]?.role === 'receive' ? [m.dir] : []
  if (m.kind === 'splitter') {
    // Behind (opposite dir) is the input; it offers out the other three sides.
    const cw = nextDir(m.dir)
    return [m.dir, cw, nextDir(nextDir(cw))]
  }
  // A crossover passes items straight through on both axes, so for line-tracing
  // it is a four-way connector. This can over-connect two lines that merely cross
  // (a conservative approximation, fine for the idealised offline model).
  if (m.kind === 'crossover') return ['N', 'E', 'S', 'W']
  return [m.dir] // belt / processor / combiner / storage / spawner emit out their facing
}

/**
 * Whether the machine `m` accepts an item travelling in direction `incoming`
 * (i.e. entering from its `OPPOSITE[incoming]` side). Mirrors the per-kind input
 * rules in tick.ts so flow tracing only follows edges the simulation would.
 */
function acceptsFrom(m: Machine, incoming: Dir): boolean {
  switch (m.kind) {
    case 'belt':
    case 'storage':
    case 'seller':
      return true // accept a neighbour pointing in from any side
    case 'processor':
    case 'splitter':
      return incoming === m.dir // only from directly behind → same travel direction
    case 'crossover':
      return true // pass-through on both axes; accepts an item from any side
    case 'combiner':
      return combinerInputDirs(m.dir).includes(OPPOSITE[incoming]) // either input side
    case 'village':
      return incoming !== OPPOSITE[m.dir] // accept on the three non-output (input) sides
    case 'townhall':
      return true // a villager sink; accepts a neighbour pointing in from any side
    case 'teleporter':
      // Send pad accepts from any side (like a seller); receive pad never takes
      // an adjacent item (its stock arrives through the channel).
      return CATALOG_BY_ID[m.catalogId]?.role === 'send'
    default:
      return false // spawner and anything else never receive
  }
}

/** Compute the state after being away from `savedAt` until `now`. Pure. */
export function computeOffline(input: OfflineInput, now: number, rng: Rng): OfflineResult {
  const modifiers = input.modifiers ?? IDENTITY_TOWN_MODIFIERS
  const capMs = config.maxOfflineHours * MS_PER_HOUR
  const elapsed = Math.min(Math.max(0, now - input.savedAt), capMs)

  // Market advances by the same capped elapsed window (catchUpMarket is bounded
  // by maxOfflineHours too), and is used for the caught-up selling price below.
  const market = catchUpMarket(input.market, now, rng, modifiers)

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
    townHalls: new Map(),
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

  // A pass-through storage may be empty at the exact end of the sample, so record
  // the item type each storage held at any point during the window (its lock).
  const observedItem = new Map<string, string>()
  for (const [key, st] of sim.stores) if (st.item) observedItem.set(key, st.item)
  for (let i = 0; i < sampleTicks; i++) {
    sim = step(sim)
    for (const [key, st] of sim.stores) if (st.item) observedItem.set(key, st.item)
  }

  // Extrapolate storage per CHAIN, not per isolated storage. When a storage feeds
  // another storage — directly, or through belts/splitters/processors/combiners —
  // the upstream one is a pass-through during the sample: it receives and re-emits
  // downstream, so its net delta is ~0 and only the tail accrues. Extrapolating
  // each in isolation would leave every upstream chest empty (bug: "only the
  // second one fills"). Instead we sum the sampled net delta across each chain —
  // that sum is the chain's true intake rate (internal hand-offs cancel) — then
  // fill the chain from its downstream tail backward, letting overflow back up
  // into the upstream chests exactly as back-pressure would over the elapsed time.
  const nextStores = new Map(input.stores)
  const stockpiledByItem: Record<string, number> = {}

  const storageKeys: string[] = []
  for (const [key, m] of input.machines) if (m.kind === 'storage') storageKeys.push(key)

  const sampledDelta = (key: string) =>
    (sim.stores.get(key)?.count ?? 0) - (baseStore.get(key) ?? 0)

  // Directed edges: which storages does `key` feed? Trace the item leaving its
  // facing side forward through transport/transform machines (belts, splitters,
  // processors, combiners) until it reaches other storages. Sellers and dead ends
  // terminate a branch. Only hops the simulation would actually make are followed.
  const downstream = new Map<string, Set<string>>()
  for (const key of storageKeys) {
    const targets = new Set<string>()
    const src = input.machines.get(key)!
    const visited = new Set<string>() // transport cells already expanded (cycle guard)
    const stack: { x: number; y: number; dir: Dir }[] = []
    for (const dir of outputDirs(src)) stack.push({ x: src.x, y: src.y, dir })
    while (stack.length) {
      const { x, y, dir } = stack.pop()!
      const { dx, dy } = dirDelta(dir)
      const nkey = cellKey(x + dx, y + dy)
      const nm = input.machines.get(nkey)
      if (!nm || !acceptsFrom(nm, dir)) continue
      if (nm.kind === 'storage') {
        if (nkey !== key) targets.add(nkey) // reached another chest → chain edge
        continue // a storage is a chain boundary; don't trace through it
      }
      if (nm.kind === 'seller') continue // drains the line; not a storage edge
      if (visited.has(nkey)) continue
      visited.add(nkey)
      for (const out of outputDirs(nm)) stack.push({ x: nm.x, y: nm.y, dir: out })
    }
    if (targets.size) downstream.set(key, targets)
  }

  // Group storages into connected chains (feed edges treated as undirected).
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
      const neighbours: string[] = [...(downstream.get(cur) ?? [])]
      for (const [from, tos] of downstream) if (tos.has(cur)) neighbours.push(from)
      for (const nb of neighbours) {
        if (!chainOf.has(nb)) {
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
    for (const key of members) deltaSum += sampledDelta(key)
    if (deltaSum <= 0) continue
    let remaining = Math.floor((deltaSum / sampleMs) * elapsed)
    if (remaining <= 0) continue

    // Fill downstream-tail first, then upstream: physically items reach the tail
    // and only back up once it is full. Order = reverse-topological — a member
    // whose downstream chests are all already placed (or lead outside the chain)
    // comes next, walking upstream via the feed edges.
    const pending = new Set(members)
    const order: string[] = []
    while (pending.size) {
      let progressed = false
      for (const key of pending) {
        const downs = downstream.get(key)
        const blocked = downs && [...downs].some((d) => pending.has(d))
        if (!blocked) {
          order.push(key)
          pending.delete(key)
          progressed = true
        }
      }
      if (!progressed) {
        // Cyclic layout (chests feeding each other): fall back to arbitrary order.
        for (const key of pending) order.push(key)
        pending.clear()
      }
    }

    for (const key of order) {
      const real = input.stores.get(key)
      const item = real?.item ?? observedItem.get(key) ?? null
      if (item == null) continue // never held anything in the sample → no lock
      const capacity = storageCapacity(input.machines.get(key)?.catalogId ?? '')
      const current = real?.count ?? 0
      const room = Math.max(0, capacity - current)
      const gained = Math.min(remaining, room)
      if (gained <= 0) continue
      nextStores.set(key, { item, count: current + gained })
      stockpiledByItem[item] = (stockpiledByItem[item] ?? 0) + gained
      remaining -= gained
      if (remaining <= 0) break
    }
  }

  // Extrapolate sellers: sell the extrapolated buffer once at the caught-up
  // price, then apply the town-hall sell/offline boosts to the total.
  let earned = 0
  for (const [key, buf] of sim.sellerBuffers) {
    const base = baseSeller.get(key) ?? {}
    for (const item of Object.keys(buf)) {
      const delta = buf[item] - (base[item] ?? 0)
      if (delta <= 0) continue
      earned += (delta / sampleMs) * elapsed * livePrice(market, item)
    }
  }
  earned *= modifiers.sellMultiplier * modifiers.offlineMultiplier

  const stockpiled = Object.entries(stockpiledByItem).map(([item, count]) => ({ item, count }))
  return {
    stores: nextStores,
    market,
    money: input.money + earned,
    summary: { elapsedMs: elapsed, stockpiled, earned },
  }
}
