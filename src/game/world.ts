import type { Dir, Machine } from './types'

// Helpers for the sparse, unbounded world: cell/chunk keying, direction math,
// and viewport culling via a chunk index. Coordinates are signed integers.

export type CellKey = string
export type ChunkKey = string

export function cellKey(x: number, y: number): CellKey {
  return `${x},${y}`
}

export function chunkKey(x: number, y: number, chunkSize: number): ChunkKey {
  return `${Math.floor(x / chunkSize)},${Math.floor(y / chunkSize)}`
}

export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'] as const

/** Unit cell delta for a direction. Screen y grows downward, so N is y-1. */
export function dirDelta(dir: Dir): { dx: number; dy: number } {
  switch (dir) {
    case 'N':
      return { dx: 0, dy: -1 }
    case 'E':
      return { dx: 1, dy: 0 }
    case 'S':
      return { dx: 0, dy: 1 }
    case 'W':
      return { dx: -1, dy: 0 }
  }
}

/** Next orientation when rotating 90° clockwise (N→E→S→W→N). */
export function nextDir(dir: Dir): Dir {
  return DIRS[(DIRS.indexOf(dir) + 1) % DIRS.length]
}

/** Canvas rotation (radians, clockwise) to point an east-facing sprite at dir. */
export function dirAngle(dir: Dir): number {
  switch (dir) {
    case 'E':
      return 0
    case 'S':
      return Math.PI / 2
    case 'W':
      return Math.PI
    case 'N':
      return -Math.PI / 2
  }
}

/** A spatial index from chunk key → set of occupied cell keys, for culling. */
export type ChunkIndex = Map<ChunkKey, Set<CellKey>>

export function chunkAdd(chunks: ChunkIndex, x: number, y: number, chunkSize: number): void {
  const key = chunkKey(x, y, chunkSize)
  let set = chunks.get(key)
  if (!set) {
    set = new Set()
    chunks.set(key, set)
  }
  set.add(cellKey(x, y))
}

export function chunkRemove(chunks: ChunkIndex, x: number, y: number, chunkSize: number): void {
  const key = chunkKey(x, y, chunkSize)
  const set = chunks.get(key)
  if (!set) return
  set.delete(cellKey(x, y))
  if (set.size === 0) chunks.delete(key)
}

/** Rebuild a chunk index from a world map. */
export function buildChunkIndex(world: Map<CellKey, Machine>, chunkSize: number): ChunkIndex {
  const chunks: ChunkIndex = new Map()
  for (const m of world.values()) {
    chunkAdd(chunks, m.x, m.y, chunkSize)
  }
  return chunks
}

/**
 * Collect machines whose cell falls within the inclusive world-cell rectangle,
 * visiting only the chunks that overlap it (so cost scales with the viewport,
 * not the world size).
 */
export function collectVisible(
  world: Map<CellKey, Machine>,
  chunks: ChunkIndex,
  chunkSize: number,
  minCx: number,
  minCy: number,
  maxCx: number,
  maxCy: number,
): Machine[] {
  const result: Machine[] = []
  const minChunkX = Math.floor(minCx / chunkSize)
  const maxChunkX = Math.floor(maxCx / chunkSize)
  const minChunkY = Math.floor(minCy / chunkSize)
  const maxChunkY = Math.floor(maxCy / chunkSize)

  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      const set = chunks.get(`${cx},${cy}`)
      if (!set) continue
      for (const key of set) {
        const m = world.get(key)
        if (!m) continue
        if (m.x >= minCx && m.x <= maxCx && m.y >= minCy && m.y <= maxCy) {
          result.push(m)
        }
      }
    }
  }
  return result
}

let idCounter = 0

/** Generate a unique machine id. */
export function newMachineId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  idCounter += 1
  return `m_${idCounter}_${idCounter.toString(36)}`
}
