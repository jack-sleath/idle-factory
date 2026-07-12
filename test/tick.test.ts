import { describe, it, expect } from 'vitest'
import { step, type SimState } from '../src/game/tick'
import { cellKey } from '../src/game/world'
import type { Dir, Machine, MachineKind } from '../src/game/types'

function machine(kind: MachineKind, x: number, y: number, dir: Dir, catalogId: string): Machine {
  return { id: `${x},${y}`, kind, catalogId, x, y, dir }
}
const belt = (x: number, y: number, dir: Dir) => machine('belt', x, y, dir, 'belt-basic')
const spawner = (x: number, y: number, dir: Dir) => machine('spawner', x, y, dir, 'ore-gatherer-basic') // ore, rateTicks 4

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
function itemAt(s: SimState, x: number, y: number): string | undefined {
  return s.items.get(cellKey(x, y))
}

describe('belt movement', () => {
  it('advances an item exactly one cell per tick along a belt chain', () => {
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'))
    let s: SimState = { machines, items: itemsOf([[0, 0, 'ore']]), tick: 0 }

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
    const s = step({ machines, items: itemsOf([[0, 0, 'a'], [1, 0, 'b'], [2, 0, 'c']]), tick: 0 })
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
    const s = step({ machines, items: before, tick: 0 })
    expect(itemAt(s, 0, 0)).toBe('a')
    expect(itemAt(s, 1, 0)).toBe('b')
    expect(itemAt(s, 2, 0)).toBe('c')
    expect(s.items.size).toBe(3)
  })

  it('does not mutate the input state', () => {
    const machines = worldOf(belt(0, 0, 'E'), belt(1, 0, 'E'))
    const items = itemsOf([[0, 0, 'ore']])
    const input: SimState = { machines, items, tick: 5 }
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
    const s = step({ machines, items: itemsOf([[1, 0, 'north'], [0, 1, 'west']]), tick: 0 })
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
    const s = step({ machines, items: new Map(), tick: 3 })
    expect(itemAt(s, 1, 0)).toBe('ore')
  })

  it('does not emit when not due', () => {
    const machines = worldOf(spawner(0, 0, 'E'), belt(1, 0, 'E'))
    const s = step({ machines, items: new Map(), tick: 0 }) // next tick 1, not due
    expect(s.items.size).toBe(0)
  })

  it('holds (does not emit or lose an item) when the output cell is blocked', () => {
    // 1,0 is occupied by an item that cannot move (2,0 has no belt).
    const machines = worldOf(spawner(0, 0, 'E'), belt(1, 0, 'E'))
    const s = step({ machines, items: itemsOf([[1, 0, 'gem']]), tick: 3 }) // would be due
    expect(itemAt(s, 1, 0)).toBe('gem') // unchanged
    expect(s.items.size).toBe(1) // no extra item emitted
  })
})
