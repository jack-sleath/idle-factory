import { describe, it, expect, afterEach } from 'vitest'
import {
  ACHIEVEMENTS,
  assertAchievementsWired,
  achievementById,
  newlyUnlocked,
  type AchievementContext,
  type AchievementDef,
} from '../src/game/achievements'
import {
  clearAchievementProviders,
  createHostBridgeProvider,
  notifyUnlock,
  registerAchievementProvider,
  syncProviders,
  type AchievementProvider,
} from '../src/game/achievementProviders'
import { CATALOG_BY_ID, ITEMS_BY_ID, storageCapacity } from '../src/data'
import type { Machine } from '../src/game/types'
import type { StorageState, TownHallState } from '../src/game/tick'

const VILLAGERS = ['villager', 'merchant', 'guard', 'innkeeper', 'mason', 'farmer', 'miner']
const SPECIALISTS = VILLAGERS.filter((id) => id !== 'villager')

/** Build a context, defaulting every field to empty. */
function ctx(partial: Partial<AchievementContext> = {}): AchievementContext {
  return {
    world: new Map(),
    townHalls: new Map(),
    stores: new Map(),
    money: 0,
    sellerSales: new Map(),
    ...partial,
  }
}

const teleporter = (id: string, catalogId: string, channel?: string): Machine => ({
  id,
  kind: 'teleporter',
  catalogId,
  x: 0,
  y: 0,
  dir: 'E',
  ...(channel !== undefined ? { channel } : {}),
})

/** ids returned by newlyUnlocked for a context with nothing yet unlocked. */
function unlockedIds(context: AchievementContext, already: string[] = []): string[] {
  return newlyUnlocked(context, new Set(already)).map((d) => d.id)
}

describe('achievement wiring', () => {
  it('every metadata id has exactly one predicate and vice-versa', () => {
    expect(assertAchievementsWired()).toEqual([])
  })

  it('achievementById resolves a known id and rejects an unknown one', () => {
    expect(achievementById('duck-customer')?.name).toBe('Duck Customer')
    expect(achievementById('nope')).toBeUndefined()
  })

  it('an empty world unlocks nothing', () => {
    expect(unlockedIds(ctx())).toEqual([])
  })
})

describe('pocket-monsters (all villager types in one hall)', () => {
  it('unlocks when a single hall holds every villager type', () => {
    const counts: TownHallState = Object.fromEntries(VILLAGERS.map((v) => [v, 1]))
    const townHalls = new Map<string, TownHallState>([['0,0', counts]])
    expect(unlockedIds(ctx({ townHalls }))).toContain('pocket-monsters')
  })

  it('unlocks on any surplus — the bar is at least one of each, not exactly one', () => {
    const counts: TownHallState = Object.fromEntries(VILLAGERS.map((v, i) => [v, i + 2]))
    const townHalls = new Map<string, TownHallState>([['0,0', counts]])
    expect(unlockedIds(ctx({ townHalls }))).toContain('pocket-monsters')
  })

  it('does not unlock when the set is spread across two halls', () => {
    const townHalls = new Map<string, TownHallState>([
      ['0,0', { villager: 1, merchant: 1, guard: 1, innkeeper: 1 }],
      ['1,0', { mason: 1, farmer: 1, miner: 1 }],
    ])
    expect(unlockedIds(ctx({ townHalls }))).not.toContain('pocket-monsters')
  })

  it('does not unlock when one type is missing', () => {
    const counts: TownHallState = Object.fromEntries(VILLAGERS.slice(1).map((v) => [v, 3]))
    const townHalls = new Map<string, TownHallState>([['0,0', counts]])
    expect(unlockedIds(ctx({ townHalls }))).not.toContain('pocket-monsters')
  })
})

describe('full-employment (every specialist banked anywhere)', () => {
  it('unlocks when specialists are spread across multiple halls', () => {
    const townHalls = new Map<string, TownHallState>([
      ['0,0', { merchant: 1, guard: 1, innkeeper: 1 }],
      ['1,0', { mason: 1, farmer: 1, miner: 1 }],
    ])
    expect(unlockedIds(ctx({ townHalls }))).toContain('full-employment')
  })

  it('does not require the generic base villager', () => {
    const counts: TownHallState = Object.fromEntries(SPECIALISTS.map((v) => [v, 1]))
    const townHalls = new Map<string, TownHallState>([['0,0', counts]])
    const ids = unlockedIds(ctx({ townHalls }))
    expect(ids).toContain('full-employment')
    // The base villager is absent, so the "all types in one hall" one stays locked.
    expect(ids).not.toContain('pocket-monsters')
  })

  it('does not unlock when a specialist is missing', () => {
    const townHalls = new Map<string, TownHallState>([['0,0', { merchant: 5, guard: 5 }]])
    expect(unlockedIds(ctx({ townHalls }))).not.toContain('full-employment')
  })
})

describe('seller co-occurrence achievements', () => {
  it('duck-customer unlocks when one seller has sold grapes and lemonade', () => {
    const sellerSales = new Map([['3,3', new Set(['grapes', 'lemonade'])]])
    expect(unlockedIds(ctx({ sellerSales }))).toContain('duck-customer')
  })

  it('duck-customer does not unlock when the two items are at different sellers', () => {
    const sellerSales = new Map([
      ['3,3', new Set(['grapes'])],
      ['4,4', new Set(['lemonade'])],
    ])
    expect(unlockedIds(ctx({ sellerSales }))).not.toContain('duck-customer')
  })

  it('cornucopia unlocks at eight distinct goods through one stall', () => {
    const eight = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(unlockedIds(ctx({ sellerSales: new Map([['0,0', eight]]) }))).toContain('cornucopia')
    const seven = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(unlockedIds(ctx({ sellerSales: new Map([['0,0', seven]]) }))).not.toContain('cornucopia')
  })
})

describe('diamond-hands (a storage full of diamonds)', () => {
  const storeAt = (key: string, store: StorageState, catalogId = 'storage-basic') => {
    const world = new Map<string, Machine>([
      [key, { id: 's', kind: 'storage', catalogId, x: 0, y: 0, dir: 'E' }],
    ])
    const stores = new Map<string, StorageState>([[key, store]])
    return ctx({ world, stores })
  }

  it('unlocks at capacity', () => {
    expect(unlockedIds(storeAt('0,0', { item: 'diamond', count: 500 }))).toContain('diamond-hands')
  })

  it('does not unlock below capacity', () => {
    expect(unlockedIds(storeAt('0,0', { item: 'diamond', count: 499 }))).not.toContain('diamond-hands')
  })

  it('does not unlock for a different item at capacity', () => {
    expect(unlockedIds(storeAt('0,0', { item: 'ore', count: 500 }))).not.toContain('diamond-hands')
  })
})

describe('wormhole (linked teleporter pair)', () => {
  it('unlocks when a send and receive pad share a channel', () => {
    const world = new Map<string, Machine>([
      ['0,0', teleporter('a', 'teleporter-in', 'coal')],
      ['1,0', teleporter('b', 'teleporter-out', 'coal')],
    ])
    expect(unlockedIds(ctx({ world }))).toContain('wormhole')
  })

  it('does not unlock when the channels differ', () => {
    const world = new Map<string, Machine>([
      ['0,0', teleporter('a', 'teleporter-in', 'coal')],
      ['1,0', teleporter('b', 'teleporter-out', 'ore')],
    ])
    expect(unlockedIds(ctx({ world }))).not.toContain('wormhole')
  })

  it('does not unlock for two send pads on the same channel', () => {
    const world = new Map<string, Machine>([
      ['0,0', teleporter('a', 'teleporter-in', 'coal')],
      ['1,0', teleporter('b', 'teleporter-in', 'coal')],
    ])
    expect(unlockedIds(ctx({ world }))).not.toContain('wormhole')
  })
})

describe('newlyUnlocked already-unlocked filtering', () => {
  it('never re-returns an achievement already in the unlocked set', () => {
    const sellerSales = new Map([['0,0', new Set(['grapes', 'lemonade'])]])
    const context = ctx({ sellerSales })
    expect(unlockedIds(context)).toContain('duck-customer')
    expect(unlockedIds(context, ['duck-customer'])).not.toContain('duck-customer')
  })
})

describe('achievement providers', () => {
  afterEach(() => clearAchievementProviders())

  const def = (id: string, external?: Record<string, string>): AchievementDef =>
    ({ id, name: id, description: '', emoji: '⭐', external, check: () => true })

  it('notifyUnlock fans an unlock out to every registered provider', () => {
    const seen: string[] = []
    const p: AchievementProvider = { id: 'test', unlock: (d) => seen.push(d.id) }
    registerAchievementProvider(p)
    notifyUnlock(def('duck-customer'))
    expect(seen).toEqual(['duck-customer'])
  })

  it('registering with initialUnlocked syncs immediately', () => {
    const synced: string[] = []
    const p: AchievementProvider = {
      id: 'test',
      unlock: () => {},
      syncUnlocked: (defs) => synced.push(...defs.map((d) => d.id)),
    }
    registerAchievementProvider(p, [def('a'), def('b')])
    expect(synced).toEqual(['a', 'b'])
  })

  it('a throwing provider is isolated and does not propagate', () => {
    registerAchievementProvider({ id: 'bad', unlock: () => { throw new Error('boom') } })
    expect(() => notifyUnlock(def('x'))).not.toThrow()
  })

  it('unregister via the returned disposer stops further calls', () => {
    const seen: string[] = []
    const dispose = registerAchievementProvider({ id: 'test', unlock: (d) => seen.push(d.id) })
    dispose()
    notifyUnlock(def('x'))
    expect(seen).toEqual([])
  })

  it('host-bridge provider forwards to window.gameAchievements via the external id map', () => {
    const unlocked: string[] = []
    const w = globalThis as unknown as { window?: unknown }
    const prev = w.window
    w.window = { gameAchievements: { unlock: (key: string) => unlocked.push(key) } }
    try {
      const provider = createHostBridgeProvider('steam')
      provider.unlock(def('duck-customer', { steam: 'ACH_DUCK' }))
      provider.unlock(def('no-map')) // no steam mapping → ignored
      expect(unlocked).toEqual(['ACH_DUCK'])
    } finally {
      w.window = prev
    }
  })

  it('syncProviders pushes the full unlocked set to a provider', () => {
    const synced: string[] = []
    registerAchievementProvider({
      id: 'test',
      unlock: () => {},
      syncUnlocked: (defs) => synced.push(...defs.map((d) => d.id)),
    })
    syncProviders([def('a'), def('b')])
    expect(synced).toEqual(['a', 'b'])
  })
})

// A machine of a catalog entry at a cell (kind taken from the catalog).
const machineOf = (catalogId: string, x: number, y: number, extra: Partial<Machine> = {}): Machine => ({
  id: `${catalogId}@${x},${y}`,
  kind: CATALOG_BY_ID[catalogId].kind,
  catalogId,
  x,
  y,
  dir: 'E',
  ...extra,
})

// Intended item combos for the "sell these at one stall" achievements. Declared
// here independently of the predicates: (a) every id is asserted to be a real
// item, and (b) selling exactly these must unlock the achievement — so a typo in
// either the table or the predicate surfaces as a failing test.
const SELLER_COMBOS: Record<string, string[]> = {
  'wine-and-cheese': ['wine', 'cheese'],
  'ploughmans-lunch': ['bread', 'cheese'],
  'jam-sandwich': ['bread', 'jam'],
  'movie-night': ['popcorn', 'lemonade'],
  'netflix-and-chill': ['popcorn', 'wine'],
  'milk-and-cookies': ['milk', 'cake'],
  'bottomless-brunch': ['pancakes', 'mead'],
  'just-desserts': ['ice-cream', 'custard'],
  'bees-knees': ['honey', 'mead'],
  'happy-hour': ['wine', 'mead'],
  'juice-cleanse': ['apple-juice', 'grape-juice', 'carrot-juice', 'lemon-juice', 'smoothie'],
  'bake-off': ['apple-pie', 'strawberry-pie', 'pumpkin-pie'],
  'sweet-tooth': ['sweet-strawberry-pie', 'sweet-apple-pie', 'sweet-pumpkin-pie'],
  'carrot-top': ['carrot', 'carrot-juice', 'carrot-cake'],
  'apple-of-my-eye': ['apple', 'apple-juice', 'apple-pie'],
  'life-gives-you-lemons': ['lemon', 'lemonade', 'lemon-juice'],
  'grape-expectations': ['grapes', 'grape-juice', 'wine'],
  'medieval-arsenal': ['iron-sword', 'axe', 'bow'],
  'crown-jewels': ['sapphire', 'emerald', 'ruby', 'diamond'],
  'put-a-ring-on-it': ['gold-diamond-ring'],
}

describe.each(Object.entries(SELLER_COMBOS))('seller combo: %s', (id, items) => {
  it('references only real items', () => {
    for (const item of items) expect(ITEMS_BY_ID[item], `${id} → ${item}`).toBeDefined()
  })

  it('unlocks when one seller has sold the whole combo', () => {
    const sellerSales = new Map([['0,0', new Set(items)]])
    expect(unlockedIds(ctx({ sellerSales }))).toContain(id)
  })

  it('does not unlock when one item of the combo is missing', () => {
    if (items.length < 2) return // single-item combos have nothing to drop
    const sellerSales = new Map([['0,0', new Set(items.slice(1))]])
    expect(unlockedIds(ctx({ sellerSales }))).not.toContain(id)
  })
})

describe('five-a-day (five distinct produce at one stall)', () => {
  it('unlocks at five distinct fruits/veg', () => {
    const five = new Set(['apple', 'grapes', 'strawberry', 'tomato', 'pumpkin'])
    expect(unlockedIds(ctx({ sellerSales: new Map([['0,0', five]]) }))).toContain('five-a-day')
  })

  it('does not unlock at four', () => {
    const four = new Set(['apple', 'grapes', 'strawberry', 'tomato'])
    expect(unlockedIds(ctx({ sellerSales: new Map([['0,0', four]]) }))).not.toContain('five-a-day')
  })

  it('does not count five non-produce items', () => {
    const five = new Set(['bread', 'cheese', 'wine', 'pizza', 'cake'])
    expect(unlockedIds(ctx({ sellerSales: new Map([['0,0', five]]) }))).not.toContain('five-a-day')
  })
})

const STORAGE_COMBOS: Record<string, string> = {
  'nest-egg': 'egg',
  'making-bank': 'gold-bar',
  'cash-cow': 'milk',
  'silver-lining': 'silver-bar',
}

describe.each(Object.entries(STORAGE_COMBOS))('storage combo: %s', (id, item) => {
  const cap = storageCapacity('storage-basic')
  const withStore = (count: number) =>
    ctx({
      world: new Map([['0,0', machineOf('storage-basic', 0, 0)]]),
      stores: new Map<string, StorageState>([['0,0', { item, count }]]),
    })

  it('references a real item', () => {
    expect(ITEMS_BY_ID[item]).toBeDefined()
  })

  it('unlocks at capacity but not below', () => {
    expect(unlockedIds(withStore(cap))).toContain(id)
    expect(unlockedIds(withStore(cap - 1))).not.toContain(id)
  })
})

const OWN_COMBOS: Record<string, string[]> = {
  'old-macdonald': ['cow', 'sheep', 'chicken'],
  'orchard': ['apple-orchard', 'lemon-tree', 'grape-vine'],
  'prospector': ['silver-mine', 'gold-mine', 'sapphire-deposit', 'emerald-deposit', 'ruby-deposit', 'diamond-deposit'],
  'green-thumb': [
    'wheat-field', 'corn-field', 'potato-farm', 'tomato-plant', 'carrot-patch',
    'pumpkin-patch', 'strawberry-patch', 'grape-vine', 'apple-orchard', 'lemon-tree', 'sugarcane-field',
  ],
}

describe.each(Object.entries(OWN_COMBOS))('own-machines combo: %s', (id, catalogIds) => {
  const world = (ids: string[]) => new Map(ids.map((cid, i) => [`${i},0`, machineOf(cid, i, 0)]))

  it('references only real catalog entries', () => {
    for (const cid of catalogIds) expect(CATALOG_BY_ID[cid], `${id} → ${cid}`).toBeDefined()
  })

  it('unlocks when every machine in the set is owned', () => {
    expect(unlockedIds(ctx({ world: world(catalogIds) }))).toContain(id)
  })

  it('does not unlock when one is missing', () => {
    expect(unlockedIds(ctx({ world: world(catalogIds.slice(1)) }))).not.toContain(id)
  })
})

describe('structural achievements', () => {
  it('spaghetti-junction unlocks at five crossovers, not four', () => {
    const five = new Map(Array.from({ length: 5 }, (_, i) => [`${i},0`, machineOf('crossover-basic', i, 0)]))
    expect(unlockedIds(ctx({ world: five }))).toContain('spaghetti-junction')
    const four = new Map(Array.from({ length: 4 }, (_, i) => [`${i},0`, machineOf('crossover-basic', i, 0)]))
    expect(unlockedIds(ctx({ world: four }))).not.toContain('spaghetti-junction')
  })

  it('mission-control unlocks at five linked teleporter channels', () => {
    const linked = (n: number) => {
      const w = new Map<string, Machine>()
      for (let i = 0; i < n; i++) {
        w.set(`${i},0`, machineOf('teleporter-in', i, 0, { channel: `ch${i}` }))
        w.set(`${i},1`, machineOf('teleporter-out', i, 1, { channel: `ch${i}` }))
      }
      return w
    }
    expect(unlockedIds(ctx({ world: linked(5) }))).toContain('mission-control')
    expect(unlockedIds(ctx({ world: linked(4) }))).not.toContain('mission-control')
  })

  it('roundabout unlocks for a closed belt loop but not an open line', () => {
    // 2x2 loop: (0,0)E→(1,0)S→(1,1)W→(0,1)N→(0,0)
    const loop = new Map<string, Machine>([
      ['0,0', machineOf('belt-basic', 0, 0, { dir: 'E' })],
      ['1,0', machineOf('belt-basic', 1, 0, { dir: 'S' })],
      ['1,1', machineOf('belt-basic', 1, 1, { dir: 'W' })],
      ['0,1', machineOf('belt-basic', 0, 1, { dir: 'N' })],
    ])
    expect(unlockedIds(ctx({ world: loop }))).toContain('roundabout')

    const line = new Map<string, Machine>([
      ['0,0', machineOf('belt-basic', 0, 0, { dir: 'E' })],
      ['1,0', machineOf('belt-basic', 1, 0, { dir: 'E' })],
      ['2,0', machineOf('belt-basic', 2, 0, { dir: 'E' })],
    ])
    expect(unlockedIds(ctx({ world: line }))).not.toContain('roundabout')
  })
})

describe('roster sanity', () => {
  it('every achievement has a non-empty name, description and emoji', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(a.emoji.length).toBeGreaterThan(0)
    }
  })
})
