import { describe, it, expect } from 'vitest'
import { computeOffline } from '../src/game/offline'
import { seedMarket, type Market } from '../src/game/market'
import { cellKey } from '../src/game/world'
import { config } from '../src/data/config'
import type { Dir, Machine, MachineKind } from '../src/game/types'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const CAP_MS = config.maxOfflineHours * HOUR

function machine(kind: MachineKind, x: number, y: number, dir: Dir, catalogId: string): Machine {
  return { id: `${x},${y}`, kind, catalogId, x, y, dir }
}
const gatherer = (x: number, y: number, dir: Dir) => machine('spawner', x, y, dir, 'ore-gatherer-basic')
const belt = (x: number, y: number, dir: Dir) => machine('belt', x, y, dir, 'belt-basic')
const storage = (x: number, y: number, dir: Dir) => machine('storage', x, y, dir, 'storage-basic')
const seller = (x: number, y: number, dir: Dir) => machine('seller', x, y, dir, 'seller-basic')

function worldOf(...ms: Machine[]): Map<string, Machine> {
  const w = new Map<string, Machine>()
  for (const m of ms) w.set(cellKey(m.x, m.y), m)
  return w
}
function marketWith(prices: Record<string, number>): Market {
  const items: Market['items'] = {}
  for (const id of Object.keys(prices)) items[id] = { price: prices[id], history: [prices[id]], crashed: false }
  return { lastUpdate: NOW, items }
}
const steady = () => 0.5 // neutral market factor → prices unchanged

describe('offline storage accrual', () => {
  const storageLine = () => worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), storage(2, 0, 'E'))

  it('accrues into storage over the elapsed time and never exceeds capacity', () => {
    const r = computeOffline(
      { machines: storageLine(), stores: new Map(), market: seedMarket(NOW), money: 0, savedAt: 0 },
      NOW, // savedAt 0 → elapsed clamps to the 24h cap
      steady,
    )
    const store = r.stores.get(cellKey(2, 0))!
    expect(store.item).toBe('ore')
    expect(store.count).toBe(500) // filled to capacity, clamped
    expect(r.summary.stockpiled).toContainEqual({ item: 'ore', count: 500 })
  })

  it('respects existing contents when clamping to remaining capacity', () => {
    const stores = new Map([[cellKey(2, 0), { item: 'ore', count: 480 }]])
    const r = computeOffline(
      { machines: storageLine(), stores, market: seedMarket(NOW), money: 0, savedAt: 0 },
      NOW,
      steady,
    )
    expect(r.stores.get(cellKey(2, 0))!.count).toBe(500) // 480 + 20 headroom only
  })

  it('fills BOTH storages when two are chained (not just the downstream one)', () => {
    // gatherer -> belt -> storage A (2,0) -> storage B (3,0). A feeds B directly.
    // A is a pass-through during the sample, so its net delta is ~0; the fix must
    // still back up the chain and fill it once the downstream tail is full.
    const chain = worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), storage(2, 0, 'E'), storage(3, 0, 'E'))
    const r = computeOffline(
      { machines: chain, stores: new Map(), market: seedMarket(NOW), money: 0, savedAt: 0 },
      NOW, // 24h cap → enough time to top out both chests
      steady,
    )
    const a = r.stores.get(cellKey(2, 0))
    const b = r.stores.get(cellKey(3, 0))
    expect(b?.count).toBe(500) // downstream tail fills first
    expect(a?.count).toBe(500) // upstream backs up once the tail is full
    expect(r.summary.stockpiled).toContainEqual({ item: 'ore', count: 1000 })
  })

  it('fills a chain linked through an intermediate belt', () => {
    // gatherer -> belt -> storage A (2,0) -> belt (3,0) -> storage B (4,0).
    // The storages are not adjacent; the feed runs through a belt.
    const chain = worldOf(
      gatherer(0, 0, 'E'),
      belt(1, 0, 'E'),
      storage(2, 0, 'E'),
      belt(3, 0, 'E'),
      storage(4, 0, 'E'),
    )
    const r = computeOffline(
      { machines: chain, stores: new Map(), market: seedMarket(NOW), money: 0, savedAt: 0 },
      NOW,
      steady,
    )
    expect(r.stores.get(cellKey(4, 0))?.count).toBe(500) // downstream tail
    expect(r.stores.get(cellKey(2, 0))?.count).toBe(500) // upstream backs up
  })

  it('does not fill a storage that only drains into a seller', () => {
    // gatherer -> belt -> storage (2,0) -> seller (3,0). The storage is drained as
    // fast as it fills, so it should stay empty and the seller earns instead.
    const drained = worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), storage(2, 0, 'E'), seller(3, 0, 'E'))
    const r = computeOffline(
      { machines: drained, stores: new Map(), market: marketWith({ ore: 1 }), money: 0, savedAt: NOW - HOUR },
      NOW,
      steady,
    )
    expect(r.stores.get(cellKey(2, 0))).toBeUndefined() // pass-through to seller stays empty
    expect(r.summary.earned).toBeGreaterThan(0)
  })
})

describe('offline seller earnings', () => {
  const sellerLine = () => worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), seller(2, 0, 'E'))

  const earnedFor = (priceOre: number, elapsedMs: number) =>
    computeOffline(
      {
        machines: sellerLine(),
        stores: new Map(),
        market: marketWith({ ore: priceOre }),
        money: 0,
        savedAt: NOW - elapsedMs,
      },
      NOW,
      steady,
    ).summary.earned

  it('earns money from buffered seller intake', () => {
    expect(earnedFor(1, HOUR)).toBeGreaterThan(0)
  })

  it('scales linearly with elapsed time (sold once, not compounded per interval)', () => {
    const one = earnedFor(1, HOUR)
    const two = earnedFor(1, 2 * HOUR)
    expect(two).toBeCloseTo(2 * one, 6)
  })

  it('uses the caught-up price (earnings scale with price)', () => {
    const atOne = earnedFor(1, HOUR)
    const atFive = earnedFor(5, HOUR)
    expect(atFive).toBeCloseTo(5 * atOne, 6)
  })
})

describe('offline caps and money', () => {
  it('applies a single 24h cap to the elapsed window', () => {
    const r = computeOffline(
      {
        machines: worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), storage(2, 0, 'E')),
        stores: new Map(),
        market: seedMarket(NOW),
        money: 100,
        savedAt: NOW - 100 * 24 * HOUR, // 100 days away
      },
      NOW,
      steady,
    )
    expect(r.summary.elapsedMs).toBe(CAP_MS)
  })

  it('adds earnings to the incoming money balance', () => {
    const r = computeOffline(
      {
        machines: worldOf(gatherer(0, 0, 'E'), belt(1, 0, 'E'), seller(2, 0, 'E')),
        stores: new Map(),
        market: marketWith({ ore: 1 }),
        money: 1000,
        savedAt: NOW - HOUR,
      },
      NOW,
      steady,
    )
    expect(r.money).toBeGreaterThan(1000)
    expect(r.money).toBeCloseTo(1000 + r.summary.earned, 6)
  })
})
