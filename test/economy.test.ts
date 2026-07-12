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

  it('always charges full price for non-free machines', () => {
    const seller = CATALOG_BY_ID['seller-basic'] // cost 50, not free
    expect(effectiveCost(seller, 0)).toBe(50)
    expect(effectiveCost(seller, 2)).toBe(50)
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
