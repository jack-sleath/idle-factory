import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore, seedStarterKit } from '../src/store/gameStore'
import { loadSave } from '../src/game/save'
import { seedMarket } from '../src/game/market'
import { cellKey } from '../src/game/world'
import { config } from '../src/data/config'

function resetToEmptyWorld() {
  localStorage.clear()
  useGameStore.setState({
    world: new Map(),
    chunks: new Map(),
    items: new Map(),
    buffers: new Map(),
    stores: new Map(),
    money: 0,
    market: seedMarket(0),
    online: true,
    lastAway: null,
    savedAt: 0,
    selected: null,
    worldRev: 0,
    camera: { ...config.camera },
    tool: { kind: 'build', catalogId: 'belt-basic' },
  })
}

describe('starter kit (new game)', () => {
  it('seeds gatherer → conveyor → storage in a line', () => {
    const kit = seedStarterKit()
    expect(kit).toHaveLength(3)
    const byCell = new Map(kit.map((m) => [cellKey(m.x, m.y), m]))
    expect(byCell.get('0,0')?.kind).toBe('spawner')
    expect(byCell.get('1,0')?.kind).toBe('belt')
    expect(byCell.get('2,0')?.kind).toBe('storage')
    expect(kit.every((m) => m.dir === 'E')).toBe(true)
  })
})

describe('placement / rotate / delete', () => {
  beforeEach(resetToEmptyWorld)

  it('places a machine of the tool kind on an empty cell', () => {
    useGameStore.getState().place(4, 2, 'ore-gatherer-basic')
    const m = useGameStore.getState().world.get(cellKey(4, 2))
    expect(m?.kind).toBe('spawner')
    expect(m?.catalogId).toBe('ore-gatherer-basic')
    expect(m?.dir).toBe('E')
  })

  it('does not place over an occupied cell (no-op)', () => {
    const store = useGameStore.getState()
    store.place(4, 2, 'ore-gatherer-basic')
    const firstId = useGameStore.getState().world.get(cellKey(4, 2))!.id
    store.place(4, 2, 'belt-basic')
    const after = useGameStore.getState().world.get(cellKey(4, 2))!
    expect(after.id).toBe(firstId)
    expect(after.kind).toBe('spawner')
  })

  it('rotate cycles orientation E→S→W→N→E', () => {
    const store = useGameStore.getState()
    store.place(5, 5, 'belt-basic')
    const dirs: string[] = []
    for (let i = 0; i < 4; i++) {
      store.rotate(5, 5)
      dirs.push(useGameStore.getState().world.get(cellKey(5, 5))!.dir)
    }
    expect(dirs).toEqual(['S', 'W', 'N', 'E'])
  })

  it('delete removes a machine', () => {
    const store = useGameStore.getState()
    store.place(1, 1, 'belt-basic')
    expect(useGameStore.getState().world.has(cellKey(1, 1))).toBe(true)
    store.remove(1, 1)
    expect(useGameStore.getState().world.has(cellKey(1, 1))).toBe(false)
  })
})

describe('tapCell dispatches per active tool', () => {
  beforeEach(resetToEmptyWorld)

  it('build tool places; delete tool removes; rotate tool rotates', () => {
    const store = useGameStore.getState()
    store.setTool({ kind: 'build', catalogId: 'storage-basic' })
    store.tapCell(2, 3)
    expect(useGameStore.getState().world.get(cellKey(2, 3))?.kind).toBe('storage')

    store.setTool({ kind: 'rotate' })
    store.tapCell(2, 3)
    expect(useGameStore.getState().world.get(cellKey(2, 3))?.dir).toBe('S')

    store.setTool({ kind: 'delete' })
    store.tapCell(2, 3)
    expect(useGameStore.getState().world.has(cellKey(2, 3))).toBe(false)
  })

  it('select tool neither places nor deletes (negative path)', () => {
    const store = useGameStore.getState()
    // Tap empty cell with Select → nothing placed, but cell is selected.
    store.setTool({ kind: 'select' })
    store.tapCell(7, 7)
    expect(useGameStore.getState().world.has(cellKey(7, 7))).toBe(false)
    expect(useGameStore.getState().selected).toEqual({ x: 7, y: 7 })

    // Tap an existing machine with Select → machine unchanged.
    store.setTool({ kind: 'build', catalogId: 'belt-basic' })
    store.tapCell(8, 8)
    const before = useGameStore.getState().world.get(cellKey(8, 8))!
    store.setTool({ kind: 'select' })
    store.tapCell(8, 8)
    expect(useGameStore.getState().world.get(cellKey(8, 8))).toBe(before)
  })
})

describe('sell all (M5)', () => {
  beforeEach(resetToEmptyWorld)

  it('banks a storage stockpile at base price and empties it', () => {
    const store = useGameStore.getState()
    store.place(3, 0, 'storage-basic')
    // Seed the storage with 2 diamonds (base price 50 each → 100).
    useGameStore.setState({ stores: new Map([[cellKey(3, 0), { item: 'diamond', count: 2 }]]) })

    useGameStore.getState().sellAll(3, 0)
    expect(useGameStore.getState().money).toBe(100)
    expect(useGameStore.getState().stores.get(cellKey(3, 0))).toBeUndefined()
  })

  it('does nothing for a non-storage cell or an empty storage', () => {
    const store = useGameStore.getState()
    store.place(4, 0, 'belt-basic')
    store.sellAll(4, 0) // not a storage
    store.place(5, 0, 'storage-basic')
    store.sellAll(5, 0) // storage but empty
    expect(useGameStore.getState().money).toBe(0)
  })
})

describe('economy: buying = placing (M6)', () => {
  beforeEach(resetToEmptyWorld) // money 0, empty world

  it('gives the first basic free, then charges + deducts for a second', () => {
    const store = useGameStore.getState()
    store.place(0, 0, 'belt-basic') // first belt → free
    expect(useGameStore.getState().world.has(cellKey(0, 0))).toBe(true)
    expect(useGameStore.getState().money).toBe(0)

    // A second belt costs 5; with $0 it can't be placed.
    store.place(1, 0, 'belt-basic')
    expect(useGameStore.getState().world.has(cellKey(1, 0))).toBe(false)

    // With money, the second belt places and its cost is deducted.
    useGameStore.setState({ money: 10 })
    useGameStore.getState().place(1, 0, 'belt-basic')
    expect(useGameStore.getState().world.has(cellKey(1, 0))).toBe(true)
    expect(useGameStore.getState().money).toBe(5)
  })

  it('refuses to place a priced machine the player cannot afford', () => {
    useGameStore.setState({ money: 40 })
    useGameStore.getState().place(2, 2, 'seller-basic') // costs 50
    expect(useGameStore.getState().world.has(cellKey(2, 2))).toBe(false)
    expect(useGameStore.getState().money).toBe(40) // unchanged
  })

  it('recovers a fully-deleted world from $0 via the free-first basics', () => {
    const store = useGameStore.getState()
    store.place(0, 0, 'ore-gatherer-basic') // free (none placed)
    store.place(1, 0, 'belt-basic') // free
    store.place(2, 0, 'storage-basic') // free
    const w = useGameStore.getState().world
    expect(w.has(cellKey(0, 0)) && w.has(cellKey(1, 0)) && w.has(cellKey(2, 0))).toBe(true)
    expect(useGameStore.getState().money).toBe(0) // rebuilt for free
  })

  it('buying a spawner variant (cow) produces its own item (milk)', () => {
    const store = useGameStore.getState()
    useGameStore.setState({ money: 200 })
    store.place(0, 0, 'cow') // 🐄 costs 100 → milk every 6 ticks
    store.place(1, 0, 'belt-basic') // free first belt
    expect(useGameStore.getState().money).toBe(100)

    for (let i = 0; i < 12; i++) useGameStore.getState().advanceTick()
    expect([...useGameStore.getState().items.values()]).toContain('milk')
  })
})

describe('save management: export / import (M8)', () => {
  beforeEach(resetToEmptyWorld)

  it('exports a valid JSON save carrying the current game state', () => {
    const store = useGameStore.getState()
    store.place(0, 0, 'ore-gatherer-basic')
    store.place(1, 0, 'belt-basic')
    useGameStore.setState({ money: 777 })

    const json = useGameStore.getState().exportSaveString()
    const parsed = JSON.parse(json) // must be valid JSON
    expect(parsed.version).toBe(config.saveVersion)
    expect(parsed.money).toBe(777)
    expect(parsed.machines).toHaveLength(2)
    expect(parsed.market).toBeTruthy()
  })

  it('imports an exported save and fully restores the game state', () => {
    const store = useGameStore.getState()
    store.place(2, 3, 'ore-gatherer-basic')
    store.place(3, 3, 'belt-basic')
    useGameStore.setState({
      money: 1234,
      stores: new Map([[cellKey(5, 5), { item: 'gem', count: 7 }]]),
    })
    const json = useGameStore.getState().exportSaveString()

    // Wipe everything, then import.
    resetToEmptyWorld()
    expect(useGameStore.getState().world.size).toBe(0)
    expect(useGameStore.getState().importSave(json)).toBe(true)

    const s = useGameStore.getState()
    expect(s.money).toBe(1234)
    expect(s.world.get(cellKey(2, 3))?.kind).toBe('spawner')
    expect(s.world.get(cellKey(3, 3))?.kind).toBe('belt')
    expect(s.stores.get(cellKey(5, 5))).toEqual({ item: 'gem', count: 7 })
  })

  it('rejects malformed import data without changing state', () => {
    const store = useGameStore.getState()
    store.place(1, 1, 'belt-basic')
    useGameStore.setState({ money: 50 })

    expect(useGameStore.getState().importSave('not json')).toBe(false)
    expect(useGameStore.getState().money).toBe(50) // unchanged
    expect(useGameStore.getState().world.has(cellKey(1, 1))).toBe(true)
  })
})

describe('offline progression on return (M9)', () => {
  beforeEach(resetToEmptyWorld)

  it('clears in-flight belt items, accrues storage, and sets an away summary', () => {
    const store = useGameStore.getState()
    store.place(0, 0, 'ore-gatherer-basic')
    store.place(1, 0, 'belt-basic')
    store.place(2, 0, 'storage-basic')
    // Pretend we left 2 hours ago, with an item mid-belt.
    useGameStore.setState({
      items: new Map([[cellKey(1, 0), 'ore']]),
      savedAt: Date.now() - 2 * 3_600_000,
    })

    useGameStore.getState().applyOfflineProgress()
    const s = useGameStore.getState()

    expect(s.items.size).toBe(0) // in-flight items cleared across the skip
    expect(s.stores.get(cellKey(2, 0))!.count).toBeGreaterThan(0) // stockpiled while away
    expect(s.lastAway).not.toBeNull()
    expect(s.lastAway!.stockpiled.some((e) => e.item === 'ore')).toBe(true)
    expect(s.savedAt).toBeGreaterThan(Date.now() - 5_000) // stamped to ~now
  })

  it('is a no-op for a brand-new game (savedAt 0)', () => {
    useGameStore.setState({ savedAt: 0, money: 0 })
    useGameStore.getState().applyOfflineProgress()
    expect(useGameStore.getState().money).toBe(0)
    expect(useGameStore.getState().lastAway).toBeNull()
  })
})

describe('persistence (reload restores layout)', () => {
  beforeEach(resetToEmptyWorld)

  it('saveNow writes a save that reloads to the same layout + camera', () => {
    const store = useGameStore.getState()
    store.place(0, 0, 'ore-gatherer-basic')
    store.place(1, 0, 'belt-basic')
    store.place(2, 0, 'storage-basic')
    useGameStore.getState().rotate(1, 0) // belt now faces S
    useGameStore.getState().setCamera({ x: 5, y: -3, zoom: 100 })
    useGameStore.getState().saveNow()

    const loaded = loadSave()
    expect(loaded).not.toBeNull()
    expect(loaded!.camera).toEqual({ x: 5, y: -3, zoom: 100 })
    const cells = loaded!.machines.map((m) => `${m.catalogId}@${m.x},${m.y}:${m.dir}`).sort()
    expect(cells).toEqual([
      'belt-basic@1,0:S',
      'ore-gatherer-basic@0,0:E',
      'storage-basic@2,0:E',
    ])
  })
})
