import { describe, it, expect } from 'vitest'
import {
  cellKey,
  chunkAdd,
  chunkRemove,
  collectVisible,
  dirDelta,
  nextDir,
  newMachineId,
  type ChunkIndex,
} from '../src/game/world'
import type { Machine } from '../src/game/types'

const CHUNK = 16

function makeMachine(x: number, y: number): Machine {
  return { id: `${x},${y}`, kind: 'belt', catalogId: 'belt-basic', x, y, dir: 'E' }
}

describe('direction helpers', () => {
  it('dirDelta uses screen-down coordinates (N = y-1)', () => {
    expect(dirDelta('N')).toEqual({ dx: 0, dy: -1 })
    expect(dirDelta('E')).toEqual({ dx: 1, dy: 0 })
    expect(dirDelta('S')).toEqual({ dx: 0, dy: 1 })
    expect(dirDelta('W')).toEqual({ dx: -1, dy: 0 })
  })

  it('nextDir cycles N→E→S→W→N', () => {
    expect(nextDir('N')).toBe('E')
    expect(nextDir('E')).toBe('S')
    expect(nextDir('S')).toBe('W')
    expect(nextDir('W')).toBe('N')
  })
})

describe('chunk index + culling', () => {
  it('collects only machines within the queried rectangle (signed coords)', () => {
    const world = new Map<string, Machine>()
    const chunks: ChunkIndex = new Map()
    const add = (x: number, y: number) => {
      const m = makeMachine(x, y)
      world.set(cellKey(x, y), m)
      chunkAdd(chunks, x, y, CHUNK)
    }
    add(0, 0)
    add(5, 5)
    add(20, 20)
    add(-3, -3)

    const inView = collectVisible(world, chunks, CHUNK, -1, -1, 6, 6).map((m) => cellKey(m.x, m.y))
    expect(inView.sort()).toEqual(['0,0', '5,5'])

    const negView = collectVisible(world, chunks, CHUNK, -5, -5, -1, -1).map((m) => cellKey(m.x, m.y))
    expect(negView).toEqual(['-3,-3'])
  })

  it('chunkRemove drops the cell and prunes empty chunks', () => {
    const chunks: ChunkIndex = new Map()
    chunkAdd(chunks, 1, 1, CHUNK)
    chunkAdd(chunks, 2, 2, CHUNK)
    chunkRemove(chunks, 1, 1, CHUNK)
    chunkRemove(chunks, 2, 2, CHUNK)
    expect(chunks.size).toBe(0)
  })
})

describe('newMachineId', () => {
  it('returns unique ids', () => {
    const ids = new Set([newMachineId(), newMachineId(), newMachineId()])
    expect(ids.size).toBe(3)
  })
})
