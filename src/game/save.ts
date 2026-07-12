import type { Camera } from '../render/camera'
import type { Machine } from './types'
import { config } from '../data/config'

// Versioned save schema + localStorage read/write. Kept deliberately small in
// M2 (layout + camera); money, items, and market state join it in later
// milestones. The version field allows future migration (M8).

export const SAVE_KEY = 'idle-factory/save'

export interface SaveV1 {
  version: number
  savedAt: number
  camera: Camera
  machines: Machine[]
}

export function makeSave(camera: Camera, machines: Machine[], savedAt: number): SaveV1 {
  return { version: config.saveVersion, savedAt, camera, machines }
}

/** Parse and lightly validate a persisted save; returns null if unusable. */
export function parseSave(raw: string): SaveV1 | null {
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
  }
}

export function loadSave(): SaveV1 | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SAVE_KEY)
  return raw ? parseSave(raw) : null
}

export function writeSave(save: SaveV1): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Ignore quota/serialization failures; the game keeps running in memory.
  }
}
