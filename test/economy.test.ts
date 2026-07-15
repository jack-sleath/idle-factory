import { describe, it, expect } from 'vitest'
import { countPlaced, effectiveCost } from '../src/game/economy'
import { CATALOG_BY_ID } from '../src/data'
import { cellKey } from '../src/game/world'
import type { Machine } from '../src/game/types'

function machine(catalogId: string, kind: Machine['kind'], x: number): Machine {
  return { id: `${catalogId}-${x}`, kind, catalogId, x, y: 0, dir: 'E' }
}

describe('effectiveCost (first-free basics)', () => {
  it('makes the first basic of a kind free and later copies full price', () => {
    const belt = CATALOG_BY_ID['belt-basic'] // cost 5, freeIfNonePlaced
    expect(effectiveCost(belt, 0)).toBe(0)
    expect(effectiveCost(belt, 1)).toBe(5)
    expect(effectiveCost(belt, 4)).toBe(5)
  })

  it('always charges full price for non-free machines with no growth', () => {
    const seller = CATALOG_BY_ID['seller-basic'] // cost 50, not free, flat
    expect(effectiveCost(seller, 0)).toBe(50)
    expect(effectiveCost(seller, 2)).toBe(50)
  })

  it('scales cost per copy when costGrowth is set', () => {
    const entry = { id: 'x', kind: 'spawner', name: 'X', emoji: '⛏️', cost: 100, costGrowth: 1.1 } as const
    // First paid copy is the base cost; each later copy is base × growth^placed.
    expect(effectiveCost(entry, 0)).toBe(100)
    expect(effectiveCost(entry, 1)).toBe(110)
    expect(effectiveCost(entry, 2)).toBe(121)
    expect(effectiveCost(entry, 10)).toBe(Math.round(100 * 1.1 ** 10))
    // Growth is monotonic increasing.
    expect(effectiveCost(entry, 5)).toBeGreaterThan(effectiveCost(entry, 4))
  })

  it('a free-first-of-kind copy is still free even with growth', () => {
    const entry = { id: 'y', kind: 'spawner', name: 'Y', emoji: '⛏️', cost: 100, costGrowth: 1.2, freeIfNonePlaced: true } as const
    expect(effectiveCost(entry, 0)).toBe(0)
    expect(effectiveCost(entry, 1)).toBe(120)
  })
})

describe('countPlaced', () => {
  it('counts only machines with the matching catalog id', () => {
    const world = new Map<string, Machine>()
    world.set(cellKey(0, 0), machine('belt-basic', 'belt', 0))
    world.set(cellKey(1, 0), machine('belt-basic', 'belt', 1))
    world.set(cellKey(2, 0), machine('seller-basic', 'seller', 2))
    expect(countPlaced(world, 'belt-basic')).toBe(2)
    expect(countPlaced(world, 'seller-basic')).toBe(1)
    expect(countPlaced(world, 'cow')).toBe(0)
  })
})
