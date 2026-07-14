import type { Camera } from '../render/camera'
import type { Machine } from './types'
import type { Market } from './market'
import { CATALOG_BY_ID, ITEMS_BY_ID } from '../data'
import { config } from '../data/config'
import { cellKey } from './world'

// Versioned save schema + localStorage read/write. v1 (M2) held layout + camera;
// v2 (M5) added the bank balance and per-storage contents; v3 (M7) added market
// state; v4 (recipe expansion) overhauled the item/catalog set. In-transit belt
// items and processor/combiner buffers are deliberately not persisted (they are
// cheap, transient, and cleared on offline catch-up in M9). Parsing tolerates
// older saves by filling new fields with defaults, and `migrateSave` upgrades
// them so an old layout keeps its machines and money after a content change.

export const SAVE_KEY = 'idle-factory/save'

/** A storage machine's persisted contents, keyed by its cell. */
export interface StoredStorage {
  key: string
  item: string | null
  count: number
}

/** A town hall's persisted banked villagers, keyed by its cell. */
export interface StoredTownHall {
  key: string
  counts: Record<string, number>
}

export interface GameSave {
  version: number
  savedAt: number
  camera: Camera
  machines: Machine[]
  money: number
  stores: StoredStorage[]
  /** Persisted town halls (banked villagers); empty for saves predating them. */
  townHalls: StoredTownHall[]
  /** Persisted market; null for pre-M7 saves (a fresh market is seeded then). */
  market: Market | null
}

export function makeSave(
  camera: Camera,
  machines: Machine[],
  savedAt: number,
  money = 0,
  stores: StoredStorage[] = [],
  market: Market | null = null,
  townHalls: StoredTownHall[] = [],
): GameSave {
  return { version: config.saveVersion, savedAt, camera, machines, money, stores, townHalls, market }
}

/** Loose runtime check that a parsed value looks like a Market. */
function isMarket(value: unknown): value is Market {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return typeof m.lastUpdate === 'number' && typeof m.items === 'object' && m.items !== null
}

/** Parse and lightly validate a persisted save; returns null if unusable. */
export function parseSave(raw: string): GameSave | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (typeof obj.version !== 'number') return null
  if (!Array.isArray(obj.machines)) return null
  const camera = obj.camera as Camera | undefined
  if (!camera || typeof camera.x !== 'number' || typeof camera.zoom !== 'number') return null
  return {
    version: obj.version,
    savedAt: typeof obj.savedAt === 'number' ? obj.savedAt : 0,
    camera,
    machines: obj.machines as Machine[],
    money: typeof obj.money === 'number' ? obj.money : 0,
    stores: Array.isArray(obj.stores) ? (obj.stores as StoredStorage[]) : [],
    townHalls: Array.isArray(obj.townHalls) ? (obj.townHalls as StoredTownHall[]) : [],
    market: isMarket(obj.market) ? obj.market : null,
  }
}

// Catalog ids that were renamed across a content change; map old -> new so a
// placed machine survives instead of turning into an unknown tile.
const CATALOG_RENAMES: Record<string, string> = { 'deep-miner': 'diamond-deposit' }

/**
 * Upgrade a parsed save to the current schema. Older saves predate the item /
 * catalog overhaul, so we: remap renamed machine catalog ids (dropping any that
 * no longer exist), reseed the market (it is keyed by the old item set), prune
 * storage locked to items that no longer exist, and drop town halls that lost
 * their machine (pruning any banked villager ids that no longer exist). Layout
 * and money are kept.
 */
export function migrateSave(save: GameSave): GameSave {
  if (save.version >= config.saveVersion) return save
  const machines = save.machines
    .map((m) => {
      const catalogId = CATALOG_RENAMES[m.catalogId] ?? m.catalogId
      return catalogId === m.catalogId ? m : { ...m, catalogId }
    })
    .filter((m) => CATALOG_BY_ID[m.catalogId] !== undefined)
  const stores = save.stores.filter((s) => s.item === null || ITEMS_BY_ID[s.item] !== undefined)
  // Only keep town halls whose cell still holds a town-hall machine, and drop
  // banked counts for any villager id that no longer exists.
  const townHallCells = new Set(
    machines.filter((m) => m.kind === 'townhall').map((m) => cellKey(m.x, m.y)),
  )
  const townHalls = (save.townHalls ?? [])
    .filter((h) => townHallCells.has(h.key))
    .map((h) => {
      const counts: Record<string, number> = {}
      for (const [id, n] of Object.entries(h.counts)) if (ITEMS_BY_ID[id]) counts[id] = n
      return { key: h.key, counts }
    })
  return { ...save, version: config.saveVersion, machines, stores, townHalls, market: null }
}

export function loadSave(): GameSave | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SAVE_KEY)
  const save = raw ? parseSave(raw) : null
  return save ? migrateSave(save) : null
}

export function writeSave(save: GameSave): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Ignore quota/serialization failures; the game keeps running in memory.
  }
}
