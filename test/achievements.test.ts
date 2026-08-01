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

describe('roster sanity', () => {
  it('every achievement has a non-empty name, description and emoji', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(a.emoji.length).toBeGreaterThan(0)
    }
  })
})
