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
  extra: Partial<Pick<SimState, 'stores' | 'money' | 'online' | 'prices'>> = {},
): SimState {
  return {
    machines,
    items,
    buffers,
    stores: extra.stores ?? new Map(),
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
    const s = step(mkState(machines, itemsOf([[1, 0, 'gem']]), 3)) // would be due
    expect(itemAt(s, 1, 0)).toBe('gem') // unchanged
    expect(s.items.size).toBe(1) // no extra item emitted
  })
})

describe('processors (M4)', () => {
  it('transforms an input item into its recipe output through the machine', () => {
    // belt(ore) → processor(E) → belt.  Recipe: ore → brick.
    const machines = worldOf(belt(0, 0, 'E'), processor(1, 0, 'E'), belt(2, 0, 'E'))
    let s = mkState(machines, itemsOf([[0, 0, 'ore']]), 0)

    s = step(s) // ore pulled off the belt into the processor's input slot
    expect(itemAt(s, 0, 0)).toBeUndefined()
    expect(bufAt(s, 1, 0)?.in[0]).toBe('ore')

    s = step(s) // input transforms into the held output
    expect(bufAt(s, 1, 0)?.out).toBe('brick')

    s = step(s) // output pushed onto the downstream belt
    expect(itemAt(s, 2, 0)).toBe('brick')
    expect(bufAt(s, 1, 0)).toBeUndefined() // machine emptied
  })

  it('holds its output when the downstream cell is blocked, losing nothing', () => {
    // Processor holds a brick; its only exit belt is jammed (nothing beyond it).
    const machines = worldOf(processor(0, 0, 'E'), belt(1, 0, 'E'))
    const buffers = buffersOf([[0, 0, { in: [null], out: 'brick' }]])
    const s = step(mkState(machines, itemsOf([[1, 0, 'ore']]), 0, buffers))

    expect(bufAt(s, 0, 0)?.out).toBe('brick') // still held
    expect(itemAt(s, 1, 0)).toBe('ore') // jam unchanged
    // No duplication or loss: exactly one buffered output and one belt item.
    expect(s.buffers.size).toBe(1)
    expect(s.items.size).toBe(1)
  })

  it('turns an input with no matching recipe into junk', () => {
    // gem has no processor recipe → junk fallback.
    const machines = worldOf(belt(0, 0, 'E'), processor(1, 0, 'E'), belt(2, 0, 'E'))
    let s = mkState(machines, itemsOf([[0, 0, 'gem']]), 0)
    s = step(s)
    s = step(s)
    s = step(s)
    expect(itemAt(s, 2, 0)).toBe('junk')
  })
})

describe('combiners (M4)', () => {
  // An east-facing combiner takes inputs on its N and S sides; recipe brick+gem → ring.
  const layout = () =>
    worldOf(
      belt(1, 0, 'S'), // north side, pointing into the combiner
      belt(1, 2, 'N'), // south side, pointing into the combiner
      combiner(1, 1, 'E'),
      belt(2, 1, 'E'), // output belt
    )

  it('combines two inputs into the recipe output regardless of which side each enters', () => {
    for (const [north, south] of [['brick', 'gem'], ['gem', 'brick']] as const) {
      let s = mkState(layout(), itemsOf([[1, 0, north], [1, 2, south]]), 0)
      s = step(s) // both inputs pulled into their slots
      expect(bufAt(s, 1, 1)?.in.filter(Boolean).sort()).toEqual(['brick', 'gem'])
      s = step(s) // pair combines into the held output
      expect(bufAt(s, 1, 1)?.out).toBe('ring')
      s = step(s) // output pushed downstream
      expect(itemAt(s, 2, 1)).toBe('ring')
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
    let s = mkState(layout(), itemsOf([[1, 0, 'brick']]), 0)
    s = step(s)
    s = step(s)
    expect(bufAt(s, 1, 1)?.in.filter(Boolean)).toEqual(['brick'])
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
    const s = step(mkState(machines, itemsOf([[0, 0, 'gem']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)).toEqual({ item: 'ore', count: 1 }) // unchanged
    expect(itemAt(s, 0, 0)).toBe('gem') // rejected → held on the belt
  })

  it('stops accepting once full (capacity 500), backing up the belt', () => {
    const machines = worldOf(belt(0, 0, 'E'), storage(1, 0, 'E'))
    const stores = storesOf([[1, 0, { item: 'ore', count: 500 }]])
    const s = step(mkState(machines, itemsOf([[0, 0, 'ore']]), 0, new Map(), { stores }))
    expect(storeAt(s, 1, 0)?.count).toBe(500) // no overflow
    expect(itemAt(s, 0, 0)).toBe('ore') // held on the belt
  })
})

describe('sellers (M5)', () => {
  it('credits money at the item base price for each item consumed while online', () => {
    // belt(gem) → seller; gem base price is 10.
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[0, 0, 'gem']]), 0, new Map(), { money: 100 }))
    expect(s.money).toBe(110)
    expect(s.items.size).toBe(0) // consumed by the seller
  })

  it('sells nothing while offline; the item backs up (buffering added in M9)', () => {
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    const s = step(mkState(machines, itemsOf([[0, 0, 'gem']]), 0, new Map(), { money: 100, online: false }))
    expect(s.money).toBe(100) // no credit offline
    expect(itemAt(s, 0, 0)).toBe('gem') // inert seller → held on the belt
  })

  it('credits money at the live market price when one is supplied (M7)', () => {
    const machines = worldOf(belt(0, 0, 'E'), seller(1, 0, 'E'))
    // gem base price is 10; the live price of 25 must win.
    const s = step(mkState(machines, itemsOf([[0, 0, 'gem']]), 0, new Map(), { prices: { gem: 25 } }))
    expect(s.money).toBe(25)
  })
})
