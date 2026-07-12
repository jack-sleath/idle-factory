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
import { config } from '../data/config'
import { loadSave, makeSave, writeSave } from '../game/save'

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
  /** Persist immediately (e.g. on visibilitychange → hidden). */
  saveNow: () => void
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

interface InitState {
  camera: Camera
  world: Map<string, Machine>
  chunks: ChunkIndex
  savedAt: number
}

function initState(): InitState {
  const saved = loadSave()
  if (saved) {
    const world = worldFromMachines(saved.machines)
    return {
      camera: saved.camera,
      world,
      chunks: buildChunkIndex(world, config.chunkSize),
      savedAt: saved.savedAt,
    }
  }
  const world = worldFromMachines(seedStarterKit())
  return {
    camera: { ...config.camera },
    world,
    chunks: buildChunkIndex(world, config.chunkSize),
    savedAt: 0,
  }
}

// Debounced autosave shared across mutations.
let saveTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_DELAY_MS = 600

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

  const { camera, world, chunks, savedAt } = initState()

  return {
    camera,
    world,
    chunks,
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
      const { world: w, chunks: c } = get()
      const key = cellKey(cx, cy)
      // Placement requires an empty cell (occupied → no-op; open-question default).
      if (w.has(key)) return
      const machine = machineFromCatalog(catalogId, cx, cy)
      if (!machine) return
      w.set(key, machine)
      chunkAdd(c, cx, cy, config.chunkSize)
      bump()
    },

    rotate: (cx, cy) => {
      const machine = get().world.get(cellKey(cx, cy))
      if (!machine) return
      machine.dir = nextDir(machine.dir)
      bump()
    },

    remove: (cx, cy) => {
      const { world: w, chunks: c, selected } = get()
      const key = cellKey(cx, cy)
      if (!w.has(key)) return
      w.delete(key)
      chunkRemove(c, cx, cy, config.chunkSize)
      if (selected && selected.x === cx && selected.y === cy) {
        set({ selected: null })
      }
      bump()
    },

    select: (cx, cy) => {
      set({ selected: { x: cx, y: cy } })
    },

    saveNow: () => {
      const { camera: cam, world: w } = get()
      const savedAtNow = Date.now()
      set({ savedAt: savedAtNow })
      writeSave(makeSave(cam, [...w.values()], savedAtNow))
    },
  }
})
