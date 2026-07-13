import { describe, it, expect, beforeEach } from 'vitest'
import { makeSave, migrateSave, parseSave, loadSave, writeSave, SAVE_KEY, type GameSave } from '../src/game/save'
import { config } from '../src/data/config'
import type { Machine } from '../src/game/types'

const machines: Machine[] = [
  { id: 'a', kind: 'spawner', catalogId: 'ore-gatherer-basic', x: 0, y: 0, dir: 'E' },
  { id: 'b', kind: 'belt', catalogId: 'belt-basic', x: 1, y: 0, dir: 'S' },
]
const camera = { x: 3, y: -2, zoom: 90 }

describe('save schema', () => {
  beforeEach(() => localStorage.clear())

  it('makeSave stamps the configured version', () => {
    const save = makeSave(camera, machines, 12345)
    expect(save.version).toBe(config.saveVersion)
    expect(save.savedAt).toBe(12345)
    expect(save.machines).toHaveLength(2)
  })

  it('parseSave round-trips a serialized save', () => {
    const save = makeSave(camera, machines, 999)
    const parsed = parseSave(JSON.stringify(save))
    expect(parsed).not.toBeNull()
    expect(parsed!.camera).toEqual(camera)
    expect(parsed!.machines).toEqual(machines)
  })

  it('round-trips money and storage contents', () => {
    const stores = [{ key: '2,0', item: 'ore', count: 42 }]
    const save = makeSave(camera, machines, 1, 1234.5, stores)
    expect(save.version).toBe(config.saveVersion)
    const parsed = parseSave(JSON.stringify(save))!
    expect(parsed.money).toBe(1234.5)
    expect(parsed.stores).toEqual(stores)
  })

  it('round-trips market state (v3)', () => {
    const market = {
      lastUpdate: 123,
      items: { ore: { price: 2.5, history: [1, 2, 2.5], crashed: false } },
    }
    const save = makeSave(camera, machines, 1, 0, [], market)
    const parsed = parseSave(JSON.stringify(save))!
    expect(parsed.market).toEqual(market)
  })

  it('loads a legacy v1 save (no money/stores/market) with defaults', () => {
    const legacy = { version: 1, savedAt: 5, camera, machines }
    const parsed = parseSave(JSON.stringify(legacy))!
    expect(parsed).not.toBeNull()
    expect(parsed.money).toBe(0)
    expect(parsed.stores).toEqual([])
    expect(parsed.market).toBeNull()
  })

  it('parseSave rejects malformed input', () => {
    expect(parseSave('not json')).toBeNull()
    expect(parseSave('42')).toBeNull()
    expect(parseSave('{}')).toBeNull() // missing machines/camera
    expect(parseSave(JSON.stringify({ version: 1, machines: [] }))).toBeNull() // no camera
  })

  it('writeSave + loadSave round-trip through localStorage', () => {
    writeSave(makeSave(camera, machines, 500))
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
    const loaded = loadSave()
    expect(loaded!.machines).toEqual(machines)
    expect(loaded!.camera).toEqual(camera)
  })
})

describe('migrateSave (content-change upgrade)', () => {
  beforeEach(() => localStorage.clear())

  it('upgrades a pre-v4 save: reseed market, prune dead stores, remap deep-miner, keep money + layout', () => {
    const old: GameSave = {
      version: 3,
      savedAt: 1,
      camera,
      machines: [
        { id: 'a', kind: 'spawner', catalogId: 'deep-miner', x: 0, y: 0, dir: 'E' },
        { id: 'b', kind: 'belt', catalogId: 'belt-basic', x: 1, y: 0, dir: 'E' },
      ],
      money: 500,
      stores: [
        { key: '2,0', item: 'gem', count: 10 }, // removed item → pruned
        { key: '3,0', item: 'ore', count: 5 }, // survives
      ],
      market: { lastUpdate: 0, items: { gem: { price: 9, history: [9], crashed: false } } },
    }
    const m = migrateSave(old)
    expect(m.version).toBe(config.saveVersion)
    expect(m.money).toBe(500) // progress kept
    expect(m.market).toBeNull() // reseeded fresh by the store
    expect(m.stores).toEqual([{ key: '3,0', item: 'ore', count: 5 }])
    expect(m.machines.find((x) => x.id === 'a')?.catalogId).toBe('diamond-deposit') // remapped
    expect(m.machines).toHaveLength(2) // belt kept
  })

  it('leaves a current-version save untouched (same reference)', () => {
    const current = makeSave(camera, machines, 5, 100, [], { lastUpdate: 0, items: {} })
    expect(migrateSave(current)).toBe(current)
  })

  it('loadSave migrates an old save read from storage', () => {
    const old = {
      version: 3,
      savedAt: 1,
      camera,
      machines,
      money: 42,
      stores: [{ key: '0,0', item: 'gem', count: 3 }],
      market: { lastUpdate: 0, items: {} },
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(old))
    const loaded = loadSave()!
    expect(loaded.version).toBe(config.saveVersion)
    expect(loaded.money).toBe(42)
    expect(loaded.market).toBeNull()
    expect(loaded.stores).toEqual([]) // gem pruned
  })
})
