import { describe, expect, it } from 'vitest'
import {
  machineMeta,
  sourcesFor,
  spawnerRows,
  villageBrowseRequirements,
  VILLAGE_OUTPUT,
} from '../src/game/recipeGraph'
import { ITEMS } from '../src/data'

describe('sourcesFor', () => {
  it('reports a spawner as the source of a raw item', () => {
    const sources = sourcesFor('ore')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toEqual({ kind: 'spawner', catalogId: 'ore-gatherer-basic' })
  })

  it('reports a processor recipe with its single input', () => {
    const sources = sourcesFor('bar')
    expect(sources).toEqual([
      { kind: 'recipe', machine: 'processor', requirements: [{ candidates: ['ore'] }] },
    ])
  })

  it('reports a combiner recipe with both inputs', () => {
    const sources = sourcesFor('iron-sword')
    expect(sources).toEqual([
      {
        kind: 'recipe',
        machine: 'combiner',
        requirements: [{ candidates: ['stick'] }, { candidates: ['bar'] }],
      },
    ])
  })

  it('models a villager as food + drink + bed with every category option to flick through', () => {
    const sources = sourcesFor(VILLAGE_OUTPUT)
    expect(sources).toHaveLength(1)
    const src = sources[0]
    expect(src.kind).toBe('recipe')
    if (src.kind !== 'recipe') throw new Error('expected recipe')
    expect(src.machine).toBe('village')

    const [food, drink, bed] = src.requirements
    const foods = ITEMS.filter((i) => i.category === 'food').map((i) => i.id)
    const drinks = ITEMS.filter((i) => i.category === 'drink').map((i) => i.id)
    expect(food).toEqual({ candidates: foods, slotLabel: 'Food' })
    expect(drink).toEqual({ candidates: drinks, slotLabel: 'Drink' })
    expect(bed).toEqual({ candidates: ['bed'], slotLabel: 'Bed' })
    // Genuinely multiple options so the UI has something to flick through.
    expect(food.candidates.length).toBeGreaterThan(1)
    expect(drink.candidates.length).toBeGreaterThan(1)
  })

  it('returns no source for an unknown item', () => {
    expect(sourcesFor('not-a-real-item')).toEqual([])
  })

  it('every produced item bottoms out in spawners (no unresolved leaves)', () => {
    // Walk each item's tree; every non-spawner leaf must be reachable from a
    // spawner, guarding against a recipe pointing at an unobtainable input.
    const resolves = (id: string, seen: Set<string>): boolean => {
      if (seen.has(id)) return true // cycle guard — treated as resolved
      const sources = sourcesFor(id)
      if (sources.length === 0) return false
      return sources.some((s) => {
        if (s.kind === 'spawner') return true
        return s.requirements.every((r) => r.candidates.some((c) => resolves(c, new Set(seen).add(id))))
      })
    }
    for (const item of ITEMS) {
      if (item.id === 'junk') continue // fallback output, not craftable
      expect(resolves(item.id, new Set()), `${item.id} should resolve to spawners`).toBe(true)
    }
  })
})

describe('browse helpers', () => {
  it('lists every spawner with its output item', () => {
    const rows = spawnerRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.outputItem)).toBe(true)
    expect(rows.find((r) => r.catalogId === 'ore-gatherer-basic')?.outputItem).toBe('ore')
  })

  it('exposes the village recipe slots for the browse view', () => {
    const reqs = villageBrowseRequirements()
    expect(reqs.map((r) => r.slotLabel)).toEqual(['Food', 'Drink', 'Bed'])
  })

  it('names the machine behind each source', () => {
    expect(machineMeta({ kind: 'spawner', catalogId: 'ore-gatherer-basic' }).name).toBe('Ore Gatherer')
    expect(machineMeta({ kind: 'recipe', machine: 'combiner', requirements: [] }).emoji).toBe('🔀')
  })
})
