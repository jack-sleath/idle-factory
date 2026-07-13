import { describe, it, expect } from 'vitest'
import { step, type MachineBuffer, type SimState, type StorageState } from '../src/game/tick'
import { cellKey } from '../src/game/world'
import type { Dir, Machine, MachineKind } from '../src/game/types'

function machine(kind: MachineKind, x: number, y: number, dir: Dir, catalogId: string): Machine {
  return { id: `${x},${y}`, kind, catalogId, x, y, dir }
}
const belt = (x: number, y: number, dir: Dir) => machine('belt', x, y, dir, 'belt-basic')
const spawner = (x: number, y: number, dir: Dir) => machine('spawner', x, y, dir, 'ore-gatherer-basic') // ore, rateTicks 4
const processor = (x: number, y: number, dir: Dir) => machine('processor', x, y, dir, 'processor-basic')
const combiner = (x: number, y: number, dir: Dir) => machine('combiner', x, y, dir, 'combiner-basic')
const storage = (x: number, y: number, dir: Dir) => machine('storage', x, y, dir, 'storage-basic') // capacity 500
const seller = (x: number, y: number, dir: Dir) => machine('seller', x, y, dir, 'seller-basic')

function worldOf(...ms: Machine[]): Map<string, Machine> {
  const w = new Map<string, Machine>()
  for (const m of ms) w.set(cellKey(m.x, m.y), m)
  return w
}
function itemsOf(entries: [number, number, string][]): Map<string, string> {
  const m = new Map<string, string>()
  for (const [x, y, t] of entries) m.set(cellKey(x, y), t)
  return m
}
function buffersOf(entries: [number, number, MachineBuffer][]): Map<string, MachineBuffer> {
  const m = new Map<string, MachineBuffer>()
  for (const [x, y, b] of entries) m.set(cellKey(x, y), b)
  return m
}
function storesOf(entries: [number, number, StorageState][]): Map<string, StorageState> {
  const m = new Map<string, StorageState>()
  for (const [x, y, st] of entries) m.set(cellKey(x, y), st)
  return m
}
function mkState(
  machines: Map<string, Machine>,
  items: Map<string, string>,
  tick: number,
  buffers: Map<string, MachineBuffer> = new Map(),
  extra: Partial<Pick<SimState, 'stores' | 'money' | 'online' | 'prices' | 'sellerBuffers'>> = {},
): SimState {
  return {
    machines,
    items,
    buffers,
    stores: extra.stores ?? new Map(),
    sellerBuffers: extra.sellerBuffers ?? new Map(),
    money: extra.money ?? 0,
    prices: extra.prices ?? {},
    online: extra.online ?? true,
    tick,
  }
}
function itemAt(s: SimState, x: number, y: number): string | undefined {
  return s.items.get(cellKey(x, y))
}
function bufAt(s: SimState, x: number, y: number): MachineBuffer | undefined {
  return s.buffers.get(cellKey(x, y))
}
function storeAt(s: SimState, x: number, y: number): StorageState | undefined {
  return s.stores.get(cellKey(x, y))
}

describe('belt movement', () => {
  it('advances an item exactly one cell per tick along a belt chain', () => {
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'))
    let s = mkState(machines, itemsOf([[0, 0, 'ore']]), 0)

    s = step(s)
    expect(itemAt(s, 1, 0)).toBe('ore')
    expect(itemAt(s, 0, 0)).toBeUndefined()
    expect(s.items.size).toBe(1)

    s = step(s)
    expect(itemAt(s, 2, 0)).toBe('ore')

    s = step(s)
    expect(itemAt(s, 3, 0)).toBe('ore')

    // Head of the line with no downstream belt → back-pressure, item holds.
    s = step(s)
    expect(itemAt(s, 3, 0)).toBe('ore')
    expect(s.items.size).toBe(1)
  })

  it('advances a packed belt run as a unit when the head clears', () => {
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'))
    // Packed run at 0,1,2 with 3 empty.
    const s = step(mkState(machines, itemsOf([[0, 0, 'a'], [1, 0, 'b'], [2, 0, 'c']]), 0))
    expect(itemAt(s, 1, 0)).toBe('a')
    expect(itemAt(s, 2, 0)).toBe('b')
    expect(itemAt(s, 3, 0)).toBe('c')
    expect(itemAt(s, 0, 0)).toBeUndefined()
    expect(s.items.size).toBe(3)
  })

  it('applies back-pressure with no duplication or loss when the head is blocked', () => {
    // 2,0 points at 3,0 which has no belt → the whole run is stuck.
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'), belt(2, 0, 'E'))
    const before = itemsOf([[0, 0, 'a'], [1, 0, 'b'], [2, 0, 'c']])
    const s = step(mkState(machines, before, 0))
    expect(itemAt(s, 0, 0)).toBe('a')
    expect(itemAt(s, 1, 0)).toBe('b')
    expect(itemAt(s, 2, 0)).toBe('c')
    expect(s.items.size).toBe(3)
  })

  it('does not mutate the input state', () => {
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'))
    const items = itemsOf([[0, 0, 'ore']])
    const input = mkState(machines, items, 5)
    const out = step(input)
    expect(items.get(cellKey(0, 0))).toBe('ore') // input untouched
    expect(input.tick).toBe(5)
    expect(out.tick).toBe(6)
  })
})

describe('merge priority (deterministic N,E,S,W)', () => {
  it('north source wins over west source into the same cell', () => {
    // Target (1,1): north (1,0) faces S; west (0,1) faces E. Both feed (1,1).
    const machines = worldOf(belt(1, 1, 'E'), belt(1, 0, 'S'), belt(0, 1, 'E'))
    const s = step(mkState(machines, itemsOf([[1, 0, 'north'], [0, 1, 'west']]), 0))
    expect(itemAt(s, 1, 1)).toBe('north') // north wins by priority
    expect(itemAt(s, 0, 1)).toBe('west') // loser holds (back-pressure)
    expect(itemAt(s, 1, 0)).toBeUndefined() // winner moved out
    expect(s.items.size).toBe(2) // nothing duplicated or lost
  })
})

describe('spawners', () => {
  it('emits its configured item onto a free output cell on its interval', () => {
    const machines = worldOf(spawner(0, 0, 'E'), belt(1, 0, 'E'))
    // tick 3 → next tick 4, and 4 % rateTicks(4) === 0 → due.
    const s = step(mkState(machines, new Map(), 3))
    expect(itemAt(s, 1, 0)).toBe('ore')
  })

  it('does not emit when not due', () => {
    const machines = worldOf(spawner(0, 0, 'E'), belt(1, 0, 'E'))
    const s = step(mkState(machines, new Map(), 0)) // next tick 1, not due
    expect(s.items.size).toBe(0)
  })

  it('holds (does not emit or lose an item) when the output cell is blocked', () => {
    // 1,0 is occupied by an item that cannot move (2,0 has no belt).
    const machines = worldOf(spawner(0, 0, 'E'), belt(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[1, 0, 'diamond']]), 3)) // would be due
    expect(itemAt(s, 1, 0)).toBe('diamond') // unchanged
    expect(s.items.size).toBe(1) // no extra item emitted
  })
})

describe('processors (M4)', () => {
  it('transforms an input item into its recipe output through the machine', () => {
    // belt(ore) → processor(E) → belt.  Recipe: ore → bar.
    const machines = worldOf(belt(0, 0, 'E'), processor(1, 0, 'E'), belt(2, 0, 'E'))
    let s = mkState(machines, itemsOf([[0, 0, 'ore']]), 0)

    s = step(s) // ore pulled off the belt into the processor's input slot
    expect(itemAt(s, 0, 0)).toBeUndefined()
    expect(bufAt(s, 1, 0)?.in[0]).toBe('ore')

    s = step(s) // input transforms into the held output
    expect(bufAt(s, 1, 0)?.out).toBe('bar')

    s = step(s) // output pushed onto the downstream belt
    expect(itemAt(s, 2, 0)).toBe('bar')
    expect(bufAt(s, 1, 0)).toBeUndefined() // machine emptied
  })

  it('holds its output when the downstream cell is blocked, losing nothing', () => {
    // Processor holds a bar; its only exit belt is jammed (nothing beyond it).
    const machines = worldOf(processor(0, 0, 'E'), belt(1, 0, 'E'))
    const buffers = buffersOf([[0, 0, { in: [null], out: 'bar' }]])
    const s = step(mkState(machines, itemsOf([[1, 0, 'ore']]), 0, buffers))

    expect(bufAt(s, 0, 0)?.out).toBe('bar') // still held
    expect(itemAt(s, 1, 0)).toBe('ore') // jam unchanged
    // No duplication or loss: exactly one buffered output and one belt item.
    expect(s.buffers.size).toBe(1)
    expect(s.items.size).toBe(1)
  })

  it('turns an input with no matching recipe into junk', () => {
    // diamond has no processor recipe → junk fallback.
    const machines = worldOf(belt(0, 0, 'E'), processor(1, 0, 'E'), belt(2, 0, 'E'))
    let s = mkState(machines, itemsOf([[0, 0, 'diamond']]), 0)
    s = step(s)
    s = step(s)
    s = step(s)
    expect(itemAt(s, 2, 0)).toBe('junk')
  })
})

describe('combiners (M4)', () => {
  // An east-facing combiner takes inputs on its N and S sides; recipe gold-ring + ruby → gold-ruby-ring.
  const layout = () =>
    worldOf(
      belt(1, 0, 'S'), // north side, pointing into the combiner
      belt(1, 2, 'N'), // south side, pointing into the combiner
      combiner(1, 1, 'E'),
      belt(2, 1, 'E'), // output belt
    )

  it('combines two inputs into the recipe output regardless of which side each enters', () => {
    for (const [north, south] of [['gold-ring', 'ruby'], ['ruby', 'gold-ring']] as const) {
      let s = mkState(layout(), itemsOf([[1, 0, north], [1, 2, south]]), 0)
      s = step(s) // both inputs pulled into their slots
      expect(bufAt(s, 1, 1)?.in.filter(Boolean).sort()).toEqual(['gold-ring', 'ruby'])
      s = step(s) // pair combines into the held output
      expect(bufAt(s, 1, 1)?.out).toBe('gold-ruby-ring')
      s = step(s) // output pushed downstream
      expect(itemAt(s, 2, 1)).toBe('gold-ruby-ring')
    }
  })

  it('produces junk for a pair with no matching recipe', () => {
    // ore + ore is not a combiner recipe → junk.
    let s = mkState(layout(), itemsOf([[1, 0, 'ore'], [1, 2, 'ore']]), 0)
    s = step(s)
    s = step(s)
    s = step(s)
    expect(itemAt(s, 2, 1)).toBe('junk')
  })

  it('waits for both input sides before combining (single input is held, not lost)', () => {
    // Only the north side is fed; the combiner buffers it and waits.
    let s = mkState(layout(), itemsOf([[1, 0, 'gold-ring']]), 0)
    s = step(s)
    s = step(s)
    expect(bufAt(s, 1, 1)?.in.filter(Boolean)).toEqual(['gold-ring'])
    expect(bufAt(s, 1, 1)?.out).toBeNull()
    expect(itemAt(s, 2, 1)).toBeUndefined() // nothing emitted yet
  })
})

describe('storage (M5)', () => {
  it('locks onto the first item type it receives', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[0, 0, 'milk']]), 0))
    expect(storeAt(s, 1, 0)).toEqual({ item: 'milk', count: 1 })
    expect(s.items.size).toBe(0) // pulled off the belt into storage
  })

  it('accumulates further items of its locked type', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'))
    const stores = storesOf([[1, 0, { item: 'ore', count: 5 }]])
    const s = step(mkState(machines, itemsOf([[0, 0, 'ore']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)).toEqual({ item: 'ore', count: 6 })
    expect(s.items.size).toBe(0)
  })

  it('rejects a non-matching item, which then backs up on the belt', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'))
    const stores = storesOf([[1, 0, { item: 'ore', count: 1 }]])
    const s = step(mkState(machines, itemsOf([[0, 0, 'diamond']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)).toEqual({ item: 'ore', count: 1 }) // unchanged
    expect(itemAt(s, 0, 0)).toBe('diamond') // rejected → held on the belt
  })

  it('stops accepting once full (capacity 500), backing up the belt', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'))
    const stores = storesOf([[1, 0, { item: 'ore', count: 500 }]])
    const s = step(mkState(machines, itemsOf([[0, 0, 'ore']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)?.count).toBe(500) // no overflow
    expect(itemAt(s, 0, 0)).toBe('ore') // held on the belt
  })
})

describe('storage output (chest chaining)', () => {
  it('emits one stored item per tick onto a belt on its facing side', () => {
    const machines = worldOf(storage(0, 0, 'E'), belt(1, 0, 'E'), belt(2, 0, 'E'))
    const stores = storesOf([[0, 0, { item: 'ore', count: 3 }]])
    let s = step(mkState(machines, new Map(), 0, new Map(), { stores }))
    expect(itemAt(s, 1, 0)).toBe('ore')
    expect(storeAt(s, 0, 0)).toEqual({ item: 'ore', count: 2 })

    s = step(s)
    expect(itemAt(s, 1, 0)).toBe('ore') // next unit right behind the first
    expect(itemAt(s, 2, 0)).toBe('ore')
    expect(storeAt(s, 0, 0)).toEqual({ item: 'ore', count: 1 })
  })

  it('chains storage → belt → storage, moving the stockpile across', () => {
    const machines = worldOf(storage(0, 0, 'E'), belt(1, 0, 'E'), storage(2, 0, 'E'))
    const stores = storesOf([[0, 0, { item: 'ore', count: 2 }]])
    let s = mkState(machines, new Map(), 0, new Map(), { stores })
    for (let i = 0; i < 3; i++) s = step(s)
    expect(storeAt(s, 0, 0)).toBeUndefined() // fully drained
    expect(storeAt(s, 2, 0)).toEqual({ item: 'ore', count: 2 }) // fully received
    expect(s.items.size).toBe(0) // nothing left in transit, nothing lost
  })

  it('holds its stock when nothing in front accepts (no machine / jammed belt)', () => {
    // No machine on the facing side.
    const alone = worldOf(storage(0, 0, 'E'))
    const s1 = step(mkState(alone, new Map(), 0, new Map(), {
      stores: storesOf([[0, 0, { item: 'ore', count: 3 }]]),
    }))
    expect(storeAt(s1, 0, 0)).toEqual({ item: 'ore', count: 3 })

    // Facing belt is jammed (its item has nowhere to go) → back-pressure.
    const jammed = worldOf(storage(0, 0, 'E'), belt(1, 0, 'E'))
    const s2 = step(mkState(jammed, itemsOf([[1, 0, 'diamond']]), 0, new Map(), {
      stores: storesOf([[0, 0, { item: 'ore', count: 3 }]]),
    }))
    expect(storeAt(s2, 0, 0)).toEqual({ item: 'ore', count: 3 })
    expect(itemAt(s2, 1, 0)).toBe('diamond') // jam unchanged
    expect(s2.items.size).toBe(1)
  })

  it('clears its type lock once drained empty, then locks onto a new type', () => {
    // milk waits behind a storage holding one last ore, which drains out front.
    const machines = worldOf(belt(-1, 0, 'E'), storage(0, 0, 'E'), belt(1, 0, 'E'))
    const stores = storesOf([[0, 0, { item: 'ore', count: 1 }]])
    let s = step(mkState(machines, itemsOf([[-1, 0, 'milk']]), 0, new Map(), { stores }))
    expect(itemAt(s, 1, 0)).toBe('ore') // last unit emitted
    expect(storeAt(s, 0, 0)).toBeUndefined() // empty → lock cleared
    expect(itemAt(s, -1, 0)).toBe('milk') // rejected while still ore-locked

    s = step(s)
    expect(storeAt(s, 0, 0)).toEqual({ item: 'milk', count: 1 }) // relocked
  })

  it('passes items through at full capacity when draining (no overflow, no loss)', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'), belt(2, 0, 'E'))
    const stores = storesOf([[1, 0, { item: 'ore', count: 500 }]])
    const s = step(mkState(machines, itemsOf([[0, 0, 'ore']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)?.count).toBe(500) // one out, one in
    expect(itemAt(s, 2, 0)).toBe('ore') // emitted downstream
    expect(itemAt(s, 0, 0)).toBeUndefined() // consumed off the feeding belt
    expect(s.items.size).toBe(1)
  })

  it('feeds a seller directly, selling one unit per tick', () => {
    const machines = worldOf(storage(0, 0, 'E'), seller(1, 0, 'E'))
    const stores = storesOf([[0, 0, { item: 'diamond', count: 2 }]])
    const s = step(mkState(machines, new Map(), 0, new Map(), { stores, money: 0 }))
    expect(s.money).toBe(50) // diamond base price
    expect(storeAt(s, 0, 0)).toEqual({ item: 'diamond', count: 1 })
  })

  it('feeds a processor from behind like a belt would', () => {
    const machines = worldOf(storage(0, 0, 'E'), processor(1, 0, 'E'), belt(2, 0, 'E'))
    const stores = storesOf([[0, 0, { item: 'ore', count: 1 }]])
    const s = step(mkState(machines, new Map(), 0, new Map(), { stores }))
    expect(bufAt(s, 1, 0)?.in[0]).toBe('ore') // pulled into the processor
    expect(storeAt(s, 0, 0)).toBeUndefined()
  })

  it('deadlocks safely when two full storages face each other (no dupes or loss)', () => {
    const machines = worldOf(storage(0, 0, 'E'), storage(1, 0, 'W'))
    const stores = storesOf([
      [0, 0, { item: 'ore', count: 500 }],
      [1, 0, { item: 'ore', count: 500 }],
    ])
    const s = step(mkState(machines, new Map(), 0, new Map(), { stores }))
    expect(storeAt(s, 0, 0)?.count).toBe(500)
    expect(storeAt(s, 1, 0)?.count).toBe(500)
  })
})

describe('sellers (M5)', () => {
  it('credits money at the item base price for each item consumed while online', () => {
    // belt(diamond) → seller; diamond base price is 50.
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[0, 0, 'diamond']]), 0, new Map(), { money: 100 }))
    expect(s.money).toBe(150)
    expect(s.items.size).toBe(0) // consumed by the seller
  })

  it('buffers instead of selling while offline (no money, item consumed, M9)', () => {
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[0, 0, 'diamond']]), 0, new Map(), { money: 100, online: false }))
    expect(s.money).toBe(100) // no credit while offline
    expect(itemAt(s, 0, 0)).toBeUndefined() // consumed off the belt
    expect(s.sellerBuffers.get(cellKey(1, 0))).toEqual({ diamond: 1 }) // buffered for catch-up
  })

  it('credits money at the live market price when one is supplied (M7)', () => {
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    // diamond base price is 50; the live price of 25 must win.
    const s = step(mkState(machines, itemsOf([[0, 0, 'diamond']]), 0, new Map(), { prices: { diamond: 25 } }))
    expect(s.money).toBe(25)
  })
})
