import { describe, it, expect } from 'vitest'
import {
  assertTutorialGatesWired,
  nextTutorial,
  tutorialById,
  tutorialsForPlacedKinds,
} from '../src/game/tutorials'
import { CATALOG_BY_ID, TUTORIALS } from '../src/data'
import { seedStarterKit } from '../src/store/gameStore'
import { cellKey } from '../src/game/world'
import type { Machine } from '../src/game/types'

let nextId = 0
/** A placed machine of a catalog entry, parked out of the way of the kit. */
function machine(catalogId: string): Machine {
  const entry = CATALOG_BY_ID[catalogId]
  return { id: `m${nextId++}`, kind: entry.kind, catalogId, x: 20 + nextId, y: 20, dir: 'E' }
}

function worldOf(machines: Machine[]): Map<string, Machine> {
  return new Map(machines.map((m) => [cellKey(m.x, m.y), m]))
}

/** The card due for this factory, or null. */
function due(machines: Machine[], seen: string[], money: number, buildCostMultiplier = 1) {
  return nextTutorial({ world: worldOf(machines), money, buildCostMultiplier }, new Set(seen))
}

const dueId = (...args: Parameters<typeof due>) => due(...args)?.id ?? null

/** Lowest money at which a card comes due for this factory (Infinity if never). */
function threshold(machines: Machine[], seen: string[]): number {
  let lo = 0
  let hi = 8_000_000
  if (!due(machines, seen, hi)) return Infinity
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (due(machines, seen, mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

const BASICS = ['spawner', 'belt']
const EARLY = [...BASICS, 'processor', 'storage', 'seller']

describe('tutorial sequence', () => {
  it('opens on the starter kit: the gatherer, then the conveyor feeding it', () => {
    const kit = seedStarterKit()
    expect(dueId(kit, [], 0)).toBe('spawner')
    expect(dueId(kit, ['spawner'], 0)).toBe('belt')
  })

  it('never skips ahead, however rich the player is', () => {
    const kit = seedStarterKit()
    // A millionaire on a fresh save still gets card one first, not the town hall.
    expect(dueId(kit, [], 1_000_000)).toBe('spawner')
    expect(dueId(kit, BASICS, 1_000_000)).toBe('processor')
  })

  it('withholds the next card until the machine just taught is built', () => {
    const kit = seedStarterKit()
    // Storage is card four and the kit already has one, but the processor card
    // came before it — so the lesson waits until a processor actually exists.
    expect(dueId(kit, [...BASICS, 'processor'], 1_000_000)).toBeNull()
    const withProcessor = [...kit, machine('processor-basic')]
    expect(dueId(withProcessor, [...BASICS, 'processor'], 0)).toBe('storage')
  })

  it('walks the whole ladder in order, at most one card at a time', () => {
    // Mirrors a player who builds exactly what each card teaches and nothing else.
    const built: Record<string, string | null> = {
      spawner: null, // the kit's gatherer already counts
      belt: null,
      storage: null,
      processor: 'processor-basic',
      seller: 'seller-basic',
      combiner: 'combiner-basic',
      village: 'village-hut',
      townhall: 'town-hall',
    }
    let machines = seedStarterKit()
    const seen: string[] = []
    const ladder: { id: string; money: number }[] = []
    for (let step = 0; step < TUTORIALS.length; step++) {
      const money = threshold(machines, seen)
      const card = due(machines, seen, money)!
      ladder.push({ id: card.id, money })
      seen.push(card.id)
      const build = built[card.id]
      if (build) machines = [...machines, machine(build)]
    }
    expect(ladder.map((l) => l.id)).toEqual([
      'spawner',
      'belt',
      'processor',
      'storage',
      'seller',
      'combiner',
      'village',
      'townhall',
    ])
    // The two chain-gated cards cost real progress, priced off what they need:
    // the combiner off a second spawner, the hut off the whole villager chain.
    const at = (id: string) => ladder.find((l) => l.id === id)!.money
    expect(at('spawner')).toBe(0)
    expect(at('processor')).toBe(CATALOG_BY_ID['processor-basic'].cost)
    expect(at('combiner')).toBeGreaterThan(CATALOG_BY_ID['oak-tree'].cost)
    expect(at('village')).toBeGreaterThan(CATALOG_BY_ID['village-hut'].cost)
    expect(at('village')).toBeGreaterThan(at('combiner'))
    // Every card seen → nothing left to show.
    expect(due(machines, seen, 1_000_000)).toBeNull()
  })
})

describe('tutorial gates', () => {
  const readyForCombiner = () => [...seedStarterKit(), machine('processor-basic'), machine('seller-basic')]

  it('holds the combiner card until a second line is affordable, not just the machine', () => {
    const machines = readyForCombiner()
    const listPrice = CATALOG_BY_ID['combiner-basic'].cost
    expect(dueId(machines, EARLY, listPrice * 10)).toBeNull() // $1,200 buys the machine but nothing to feed it
    // Its real gate is the cheapest reachable pairing: a stick/planks line from an
    // oak tree against a bar from the ore already flowing.
    const gate = threshold(machines, EARLY)
    expect(gate).toBeGreaterThan(CATALOG_BY_ID['oak-tree'].cost)
    expect(dueId(machines, EARLY, gate)).toBe('combiner')
  })

  it('drops the combiner gate to pocket change once that second spawner is owned', () => {
    const withoutOak = threshold(readyForCombiner(), EARLY)
    const withOak = threshold([...readyForCombiner(), machine('oak-tree')], EARLY)
    // Owning the spawner leaves only the plumbing to pay for, and the saving is
    // essentially the spawner's whole price — that is what the gate is tracking.
    expect(withOak).toBeLessThan(withoutOak)
    expect(withoutOak - withOak).toBeGreaterThanOrEqual(CATALOG_BY_ID['oak-tree'].cost * 0.9)
  })

  it('holds the village card until a food, a drink and a bed are all reachable', () => {
    const machines = [...readyForCombiner(), machine('combiner-basic')]
    const seen = [...EARLY, 'combiner']
    // Affording the hut itself is not enough — it needs three lines to feed it.
    expect(dueId(machines, seen, CATALOG_BY_ID['village-hut'].cost)).toBeNull()
    const gate = threshold(machines, seen)
    // Wool and planks for the bed, plus a food and a drink, plus the hut.
    expect(gate).toBeGreaterThan(
      CATALOG_BY_ID['village-hut'].cost + CATALOG_BY_ID['sheep'].cost + CATALOG_BY_ID['oak-tree'].cost,
    )
    expect(dueId(machines, seen, gate)).toBe('village')
    expect(dueId(machines, seen, gate - 1)).toBeNull()
  })

  it('holds the town hall card until a hut is standing, then asks only its price', () => {
    const seen = [...EARLY, 'combiner', 'village']
    const noHut = [...readyForCombiner(), machine('combiner-basic')]
    expect(dueId(noHut, seen, 1_000_000)).toBeNull()
    const withHut = [...noHut, machine('village-hut')]
    expect(dueId(withHut, seen, CATALOG_BY_ID['town-hall'].cost - 1)).toBeNull()
    expect(dueId(withHut, seen, CATALOG_BY_ID['town-hall'].cost)).toBe('townhall')
  })

  it('prices every gate at the discount the shop actually charges', () => {
    const machines = readyForCombiner()
    const full = threshold(machines, EARLY)
    // A mason discount halves the whole chain, so the card comes due sooner.
    expect(dueId(machines, EARLY, Math.ceil(full / 2), 0.5)).toBe('combiner')
    expect(dueId(machines, EARLY, Math.floor(full / 4), 0.5)).toBeNull()
  })
})

describe('tutorial content', () => {
  it('teaches every machine kind a player must understand, one card each', () => {
    const kinds = TUTORIALS.map((t) => t.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toEqual(['spawner', 'belt', 'processor', 'storage', 'seller', 'combiner', 'village', 'townhall'])
    for (const t of TUTORIALS) expect(tutorialById(t.id)).toBe(t)
    expect(tutorialById('nope')).toBeUndefined()
  })

  it('wires every card to a gate, and every gate to a card', () => {
    expect(assertTutorialGatesWired()).toEqual([])
  })

  it('lists the cards for kinds a factory already contains (save migration)', () => {
    expect(tutorialsForPlacedKinds(seedStarterKit())).toEqual(['spawner', 'belt', 'storage'])
    expect(tutorialsForPlacedKinds([])).toEqual([])
  })
})
