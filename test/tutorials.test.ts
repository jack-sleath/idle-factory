import { describe, it, expect } from 'vitest'
import { newlyTriggered, tutorialById, tutorialsForPlacedKinds } from '../src/game/tutorials'
import { CATALOG_BY_ID, TUTORIALS } from '../src/data'
import { effectiveCost } from '../src/game/economy'
import { seedStarterKit } from '../src/store/gameStore'
import { cellKey } from '../src/game/world'
import type { Machine } from '../src/game/types'

function worldOf(machines: Machine[]): Map<string, Machine> {
  return new Map(machines.map((m) => [cellKey(m.x, m.y), m]))
}

function ctx(machines: Machine[], money: number, buildCostMultiplier = 1) {
  return { world: worldOf(machines), money, buildCostMultiplier }
}

const ids = (defs: { id: string }[]) => defs.map((d) => d.id)

/** The list price of the first copy of a catalog entry (no copies placed). */
const firstCost = (catalogId: string) => effectiveCost(CATALOG_BY_ID[catalogId], 0)

describe('tutorial triggers', () => {
  it('explains the starter kit on a fresh game, in card order', () => {
    // A new game has no money at all, but the free kit is already standing — so
    // the spawner / conveyor / storage cards fire on the concepts in play.
    const fired = newlyTriggered(ctx(seedStarterKit(), 0), new Set())
    expect(ids(fired)).toEqual(['spawner', 'belt', 'storage'])
  })

  it('fires a card as soon as its kind becomes affordable', () => {
    const seller = firstCost('seller-basic')
    const combiner = firstCost('combiner-basic')
    expect(seller).toBeLessThan(combiner) // guards the fixture below

    const broke = newlyTriggered(ctx([], seller - 1), new Set())
    expect(ids(broke)).not.toContain('seller')

    const canBuy = newlyTriggered(ctx([], seller), new Set())
    expect(ids(canBuy)).toContain('seller')
    expect(ids(canBuy)).not.toContain('combiner')
  })

  it('counts the town-hall build discount toward affordability', () => {
    const cost = firstCost('town-hall')
    const money = Math.round(cost / 2)
    expect(ids(newlyTriggered(ctx([], money), new Set()))).not.toContain('townhall')
    // A mason discount is what the shop actually charges, so the card matches it.
    expect(ids(newlyTriggered(ctx([], money, 0.5), new Set()))).toContain('townhall')
  })

  it('prices the next copy, not the first, when copies are already placed', () => {
    // Spawners grow in cost per copy, so owning one raises the bar for the next.
    const entry = CATALOG_BY_ID['ore-gatherer-basic']
    const kit = seedStarterKit()
    const first = effectiveCost(entry, 0)
    const second = effectiveCost(entry, 1)
    expect(second).toBeGreaterThan(first)
    // With the kit's gatherer standing, the spawner card fires on the placed kind
    // regardless of money — but a world with only the belt does not.
    const beltOnly = kit.filter((m) => m.kind === 'belt')
    expect(ids(newlyTriggered(ctx(beltOnly, first), new Set()))).toContain('spawner')
    expect(ids(newlyTriggered(ctx(beltOnly, first - 1), new Set()))).not.toContain('spawner')
  })

  it('never re-fires a card the player has already seen', () => {
    const rich = ctx(seedStarterKit(), 1_000_000)
    const all = ids(newlyTriggered(rich, new Set()))
    expect(all).toEqual(ids(TUTORIALS)) // a millionaire can afford every kind
    expect(newlyTriggered(rich, new Set(all))).toEqual([])
    const exceptStorage = new Set(all.filter((id) => id !== 'storage'))
    expect(ids(newlyTriggered(rich, exceptStorage))).toEqual(['storage'])
  })

  it('covers every kind the player is taught, with a card per kind', () => {
    const kinds = TUTORIALS.map((t) => t.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toEqual(
      expect.arrayContaining(['spawner', 'belt', 'processor', 'seller', 'storage', 'combiner', 'village', 'townhall']),
    )
    for (const t of TUTORIALS) expect(tutorialById(t.id)).toBe(t)
    expect(tutorialById('nope')).toBeUndefined()
  })

  it('lists the cards for kinds a factory already contains (save migration)', () => {
    expect(tutorialsForPlacedKinds(seedStarterKit())).toEqual(['spawner', 'belt', 'storage'])
    expect(tutorialsForPlacedKinds([])).toEqual([])
  })
})
