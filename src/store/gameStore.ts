import { create } from 'zustand'
import type { Camera } from '../render/camera'
import type { Machine } from '../game/types'
import {
  buildChunkIndex,
  cellKey,
  chunkAdd,
  chunkRemove,
  newMachineId,
  nextDir,
  type ChunkIndex,
} from '../game/world'
import { CATALOG_BY_ID } from '../data'
import { countPlaced, effectiveCost } from '../game/economy'
import { config } from '../data/config'
import { loadSave, makeSave, migrateSave, parseSave, writeSave, type GameSave } from '../game/save'
import { step, type MachineBuffer, type StorageState, type TownHallState } from '../game/tick'
import { catchUpMarket, fillHistory, livePrice, priceSnapshot, seedMarket, type Market } from '../game/market'
import { computeOffline, type AwaySummary } from '../game/offline'
import { computeTownModifiers, type TownModifiers } from '../game/town'

/** The active palette tool; the selected tool governs what tapping a cell does. */
export type Tool =
  | { kind: 'select' }
  | { kind: 'rotate' }
  | { kind: 'delete' }
  | { kind: 'build'; catalogId: string }

export interface GameState {
  camera: Camera
  /** Sparse world: cell key `x,y` → machine. */
  world: Map<string, Machine>
  /** Chunk index over `world` for viewport culling. */
  chunks: ChunkIndex
  /** Items in transit, keyed by cell: cell key `x,y` → item type id. */
  items: Map<string, string>
  /** Internal buffers for processor/combiner cells: cell key `x,y` → buffer. */
  buffers: Map<string, MachineBuffer>
  /** Storage contents for storage cells: cell key `x,y` → {item, count}. */
  stores: Map<string, StorageState>
  /** Banked villagers for town hall cells: cell key `x,y` → {villagerId: count}. */
  townHalls: Map<string, TownHallState>
  /** Global economy modifiers derived from the summed town-hall population. */
  townModifiers: TownModifiers
  /** Round-robin cursors for splitter cells: cell key `x,y` → next side index. */
  splitterCursors: Map<string, number>
  /** Bank balance (auto-sellers credit it; Sell-All banks a storage). */
  money: number
  /** Stock-market state: prices, last-10 histories, and last update time. */
  market: Market
  /** Whether live selling is active (false only during offline sampling). */
  online: boolean
  /** Summary of the last offline catch-up, shown until dismissed (M9). */
  lastAway: AwaySummary | null
  /** Monotonic simulation tick counter. */
  tick: number
  /** Active tool. */
  tool: Tool
  /** Cell currently selected via the Select tool (for panels/highlight). */
  selected: { x: number; y: number } | null
  /** Timestamp of the last persist (used by offline catch-up in M9). */
  savedAt: number
  /** Bumped on any structural world change so React subscribers re-render. */
  worldRev: number

  setCamera: (camera: Camera) => void
  setTool: (tool: Tool) => void
  /** Dispatch a tap at a cell according to the active tool. */
  tapCell: (cx: number, cy: number) => void
  place: (cx: number, cy: number, catalogId: string) => void
  rotate: (cx: number, cy: number) => void
  remove: (cx: number, cy: number) => void
  select: (cx: number, cy: number) => void
  /** Sell a storage's full stockpile at the current price, banking the money. */
  sellAll: (cx: number, cy: number) => void
  /** Apply any market intervals that have elapsed (wall-clock driven). */
  advanceMarket: () => void
  /** Catch up stockpiles + earnings for time spent away, then set a summary. */
  applyOfflineProgress: () => void
  /** Dismiss the away summary. */
  dismissAway: () => void
  /** Advance the simulation by one tick (drives spawners + belt movement). */
  advanceTick: () => void
  /** Persist immediately (e.g. on visibilitychange → hidden). */
  saveNow: () => void
  /** Serialize the current game to a pretty-printed JSON save string (M8). */
  exportSaveString: () => string
  /** Restore state from a JSON save string; returns false if it is invalid. */
  importSave: (json: string) => boolean
  /** Reload the last localStorage save into memory; false if none exists. */
  loadFromStorage: () => boolean
}

function machineFromCatalog(catalogId: string, x: number, y: number): Machine | null {
  const entry = CATALOG_BY_ID[catalogId]
  if (!entry) return null
  return { id: newMachineId(), kind: entry.kind, catalogId, x, y, dir: entry.defaultDir ?? 'E' }
}

/** A new game seeds a working starter kit: gatherer → conveyor → storage. */
export function seedStarterKit(): Machine[] {
  const kit = [
    machineFromCatalog('ore-gatherer-basic', 0, 0),
    machineFromCatalog('belt-basic', 1, 0),
    machineFromCatalog('storage-basic', 2, 0),
  ]
  return kit.filter((m): m is Machine => m !== null)
}

function worldFromMachines(machines: Machine[]): Map<string, Machine> {
  const world = new Map<string, Machine>()
  for (const m of machines) world.set(cellKey(m.x, m.y), m)
  return world
}

function townHallsFromSaved(saved: { key: string; counts: Record<string, number> }[]): Map<string, TownHallState> {
  const m = new Map<string, TownHallState>()
  for (const h of saved) m.set(h.key, { ...h.counts })
  return m
}

function townHallList(townHalls: Map<string, TownHallState>): { key: string; counts: TownHallState }[] {
  return [...townHalls.entries()].map(([key, counts]) => ({ key, counts }))
}

interface InitState {
  camera: Camera
  world: Map<string, Machine>
  chunks: ChunkIndex
  savedAt: number
  money: number
  stores: Map<string, StorageState>
  townHalls: Map<string, TownHallState>
  market: Market
}

function initState(): InitState {
  const now = Date.now()
  const saved = loadSave()
  if (saved) {
    const world = worldFromMachines(saved.machines)
    const stores = new Map<string, StorageState>()
    for (const s of saved.stores) stores.set(s.key, { item: s.item, count: s.count })
    const townHalls = townHallsFromSaved(saved.townHalls ?? [])
    // Advance the market by however many intervals elapsed while away (capped),
    // applying the town-hall market levers, then back-fill any short sparkline.
    const modifiers = computeTownModifiers(townHalls)
    const market = fillHistory(catchUpMarket(saved.market ?? seedMarket(now), now, Math.random, modifiers))
    return {
      camera: saved.camera,
      world,
      chunks: buildChunkIndex(world, config.chunkSize),
      savedAt: saved.savedAt,
      money: saved.money,
      stores,
      townHalls,
      market,
    }
  }
  const world = worldFromMachines(seedStarterKit())
  return {
    camera: { ...config.camera },
    world,
    chunks: buildChunkIndex(world, config.chunkSize),
    savedAt: 0,
    money: config.startingMoney,
    stores: new Map(),
    townHalls: new Map(),
    market: seedMarket(now),
  }
}

// Debounced autosave shared across mutations.
let saveTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_DELAY_MS = 600

// Live play always sells online, so the seller buffer is never written; share a
// single empty map (step copies it defensively) to avoid a per-tick allocation.
const EMPTY_SELLER_BUFFERS: Map<string, Record<string, number>> = new Map()

export const useGameStore = create<GameState>((set, get) => {
  const scheduleAutosave = () => {
    if (typeof setTimeout === 'undefined') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      get().saveNow()
    }, AUTOSAVE_DELAY_MS)
  }

  const bump = () => {
    set({ worldRev: get().worldRev + 1 })
    scheduleAutosave()
  }

  // Replace all in-memory game state from a parsed save (used by Load + Import).
  // Transient items/buffers are dropped (they are never persisted); the selection
  // is cleared as it may point at a machine that no longer exists.
  const applySave = (save: GameSave) => {
    const w = worldFromMachines(save.machines)
    const nextStores = new Map<string, StorageState>()
    for (const s of save.stores) nextStores.set(s.key, { item: s.item, count: s.count })
    const nextTownHalls = townHallsFromSaved(save.townHalls ?? [])
    set({
      camera: save.camera,
      world: w,
      chunks: buildChunkIndex(w, config.chunkSize),
      items: new Map(),
      buffers: new Map(),
      stores: nextStores,
      townHalls: nextTownHalls,
      townModifiers: computeTownModifiers(nextTownHalls),
      splitterCursors: new Map(),
      money: save.money,
      market: save.market ? fillHistory(save.market) : seedMarket(Date.now()),
      savedAt: save.savedAt,
      selected: null,
      worldRev: get().worldRev + 1,
    })
  }

  const { camera, world, chunks, savedAt, money, stores, townHalls, market } = initState()

  return {
    camera,
    world,
    chunks,
    items: new Map(),
    buffers: new Map(),
    stores,
    townHalls,
    townModifiers: computeTownModifiers(townHalls),
    splitterCursors: new Map(),
    money,
    market,
    online: true,
    lastAway: null,
    tick: 0,
    tool: { kind: 'build', catalogId: 'belt-basic' },
    selected: null,
    savedAt,
    worldRev: 0,

    setCamera: (nextCamera) => {
      set({ camera: nextCamera })
      scheduleAutosave()
    },

    setTool: (tool) => set({ tool }),

    tapCell: (cx, cy) => {
      const { tool } = get()
      switch (tool.kind) {
        case 'build':
          get().place(cx, cy, tool.catalogId)
          break
        case 'rotate':
          get().rotate(cx, cy)
          break
        case 'delete':
          get().remove(cx, cy)
          break
        case 'select':
          get().select(cx, cy)
          break
      }
    },

    place: (cx, cy, catalogId) => {
      const { world: w, chunks: c, money } = get()
      const key = cellKey(cx, cy)
      // Placement requires an empty cell (occupied → no-op; open-question default).
      if (w.has(key)) return
      const entry = CATALOG_BY_ID[catalogId]
      if (!entry) return
      // Buying = placing: pay the effective cost (first basic of each is free),
      // discounted by the town-hall mason lever.
      const base = effectiveCost(entry, countPlaced(w, catalogId))
      const cost = Math.round(base * get().townModifiers.buildCostMultiplier)
      if (money < cost) return // can't afford → no-op
      const machine = machineFromCatalog(catalogId, cx, cy)
      if (!machine) return
      w.set(key, machine)
      chunkAdd(c, cx, cy, config.chunkSize)
      if (cost > 0) set({ money: money - cost })
      bump()
    },

    rotate: (cx, cy) => {
      const machine = get().world.get(cellKey(cx, cy))
      if (!machine) return
      machine.dir = nextDir(machine.dir)
      bump()
    },

    remove: (cx, cy) => {
      const { world: w, chunks: c, items, buffers, stores, townHalls, splitterCursors, selected } = get()
      const key = cellKey(cx, cy)
      if (!w.has(key)) return
      w.delete(key)
      chunkRemove(c, cx, cy, config.chunkSize)
      // Any item riding this cell, or held inside it, is removed with it.
      items.delete(key)
      buffers.delete(key)
      stores.delete(key)
      splitterCursors.delete(key)
      // Deleting a town hall discards its banked villagers, which drops its
      // contribution to the global levers — so recompute them.
      if (townHalls.delete(key)) {
        set({ townModifiers: computeTownModifiers(townHalls) })
      }
      if (selected && selected.x === cx && selected.y === cy) {
        set({ selected: null })
      }
      bump()
    },

    select: (cx, cy) => {
      set({ selected: { x: cx, y: cy } })
    },

    sellAll: (cx, cy) => {
      const { world: w, stores, money, market } = get()
      const key = cellKey(cx, cy)
      const machine = w.get(key)
      if (!machine || machine.kind !== 'storage') return
      const store = stores.get(key)
      if (!store || store.item === null || store.count <= 0) return
      const proceeds = store.count * livePrice(market, store.item) * get().townModifiers.sellMultiplier
      // Liquidate: empty and unlock the storage (new type may lock in next).
      const nextStores = new Map(stores)
      nextStores.delete(key)
      set({ stores: nextStores, money: money + proceeds })
      scheduleAutosave()
    },

    advanceMarket: () => {
      const current = get().market
      const next = catchUpMarket(current, Date.now(), Math.random, get().townModifiers)
      if (next !== current) {
        set({ market: next })
        scheduleAutosave()
      }
    },

    applyOfflineProgress: () => {
      const { world, stores, market, money, savedAt, townModifiers } = get()
      if (savedAt <= 0) return // brand-new game: nothing to catch up
      const now = Date.now()
      const result = computeOffline(
        { machines: world, stores, market, money, savedAt, modifiers: townModifiers },
        now,
        Math.random,
      )
      // Show a summary only for a meaningful absence, to avoid noise on quick
      // tab switches (but the market/stockpile catch-up always applies).
      const worthShowing = result.summary.elapsedMs >= 60_000 &&
        (result.summary.earned > 0 || result.summary.stockpiled.length > 0)
      set({
        stores: result.stores,
        market: result.market,
        money: result.money,
        items: new Map(), // in-flight belt items vanish across a time skip
        buffers: new Map(),
        splitterCursors: new Map(),
        savedAt: now,
        lastAway: worthShowing ? result.summary : get().lastAway,
      })
      get().saveNow()
    },

    dismissAway: () => set({ lastAway: null }),

    advanceTick: () => {
      const { world: w, items, buffers, stores, townHalls, splitterCursors, money, market, online, tick, townModifiers } = get()
      // Merchants (and the tiny per-villager base) raise every live sale price;
      // scaling the price snapshot applies it without touching the seller code.
      const sellMult = townModifiers.sellMultiplier
      const prices = priceSnapshot(market)
      if (sellMult !== 1) for (const id of Object.keys(prices)) prices[id] *= sellMult
      const nextSim = step({
        machines: w,
        items,
        buffers,
        stores,
        townHalls,
        sellerBuffers: EMPTY_SELLER_BUFFERS, // live play sells online; never buffers
        splitterCursors,
        money,
        prices,
        online,
        tick,
      })
      // Town halls only change when a villager is banked (clone-on-write in
      // step keeps the reference otherwise); recompute the levers just then.
      const banked = nextSim.townHalls !== townHalls
      set({
        items: nextSim.items,
        buffers: nextSim.buffers,
        stores: nextSim.stores,
        ...(banked
          ? { townHalls: nextSim.townHalls, townModifiers: computeTownModifiers(nextSim.townHalls) }
          : null),
        splitterCursors: nextSim.splitterCursors ?? new Map(),
        money: nextSim.money,
        tick: nextSim.tick,
      })
      if (banked) scheduleAutosave()
    },

    saveNow: () => {
      const { camera: cam, world: w, money, stores, townHalls, market } = get()
      const savedAtNow = Date.now()
      set({ savedAt: savedAtNow })
      const storeList = [...stores.entries()].map(([key, s]) => ({ key, item: s.item, count: s.count }))
      writeSave(makeSave(cam, [...w.values()], savedAtNow, money, storeList, market, townHallList(townHalls)))
    },

    exportSaveString: () => {
      const { camera: cam, world: w, money, stores, townHalls, market, savedAt: at } = get()
      const storeList = [...stores.entries()].map(([key, s]) => ({ key, item: s.item, count: s.count }))
      const save = makeSave(cam, [...w.values()], at || Date.now(), money, storeList, market, townHallList(townHalls))
      return JSON.stringify(save, null, 2)
    },

    importSave: (json) => {
      const save = parseSave(json)
      if (!save) return false
      applySave(migrateSave(save)) // upgrade an older imported save before applying
      get().saveNow() // persist the imported state as the new autosave
      return true
    },

    loadFromStorage: () => {
      const save = loadSave()
      if (!save) return false
      applySave(save)
      return true
    },
  }
})
