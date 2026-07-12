import type { Camera } from '../render/camera'
import type { Machine } from './types'
import { config } from '../data/config'

// Versioned save schema + localStorage read/write. v1 (M2) held layout + camera;
// v2 (M5) adds the bank balance and per-storage contents. In-transit belt items
// and processor/combiner buffers are deliberately not persisted (they are cheap,
// transient, and cleared on offline catch-up in M9). Parsing tolerates older
// saves by filling new fields with defaults, so a v1 save still loads.

export const SAVE_KEY = 'idle-factory/save'

/** A storage machine's persisted contents, keyed by its cell. */
export interface StoredStorage {
  key: string
  item: string | null
  count: number
}

export interface GameSave {
  version: number
  savedAt: number
  camera: Camera
  machines: Machine[]
  money: number
  stores: StoredStorage[]
}

export function makeSave(
  camera: Camera,
  machines: Machine[],
  savedAt: number,
  money = 0,
  stores: StoredStorage[] = [],
): GameSave {
  return { version: config.saveVersion, savedAt, camera, machines, money, stores }
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
  }
}

export function loadSave(): GameSave | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SAVE_KEY)
  return raw ? parseSave(raw) : null
}

export function writeSave(save: GameSave): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Ignore quota/serialization failures; the game keeps running in memory.
  }
}
