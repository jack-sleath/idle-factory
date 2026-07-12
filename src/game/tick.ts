import type { Dir, Machine } from './types'
import { cellKey, dirDelta } from './world'
import { CATALOG_BY_ID } from '../data'

// The simulation is a pure `step(state) -> state` function over a next-state
// buffer, so it can be driven live at a fixed tick and also run headlessly in a
// loop (reused for offline catch-up in M9). It never mutates its input.
//
// Belt movement uses a PULL model: an item advances into its belt's output cell
// only if that cell will be empty this tick and this item wins the cell. This
// makes packed belts advance as a unit, applies back-pressure when the head is
// blocked (no item is dropped or duplicated), and resolves merges
// deterministically by fixed source priority N, E, S, W.

/** The simulation state. In M3 `machines` is read-only; items live on cells. */
export interface SimState {
  machines: Map<string, Machine>
  /** cell key → item type id (a cell holds at most one item). */
  items: Map<string, string>
  /** Monotonic tick counter. */
  tick: number
}

// Neighbours of a target cell, in fixed priority order N, E, S, W, paired with
// the output direction a machine in that neighbour must have to feed the target.
const INCOMING: { dx: number; dy: number; out: Dir }[] = [
  { dx: 0, dy: -1, out: 'S' }, // north neighbour, pointing south
  { dx: 1, dy: 0, out: 'W' }, // east neighbour, pointing west
  { dx: 0, dy: 1, out: 'N' }, // south neighbour, pointing north
  { dx: -1, dy: 0, out: 'E' }, // west neighbour, pointing east
]

/** Whether a spawner is due to emit on a given tick. */
function spawnerDue(machine: Machine, tick: number): boolean {
  const entry = CATALOG_BY_ID[machine.catalogId]
  if (!entry || !entry.outputItem || !entry.rateTicks || entry.rateTicks <= 0) return false
  return tick % entry.rateTicks === 0
}

interface Source {
  key: string
  machine: Machine
  kind: 'belt' | 'spawner'
}

/**
 * The single winning source that will feed target cell (tx,ty) this tick, by
 * fixed N,E,S,W priority. A belt source must currently hold an item; a spawner
 * source must be due. Depends only on the current state, so it is stable.
 */
function winningSource(state: SimState, tx: number, ty: number, tick: number): Source | null {
  for (const nb of INCOMING) {
    const key = cellKey(tx + nb.dx, ty + nb.dy)
    const m = state.machines.get(key)
    if (!m || m.dir !== nb.out) continue
    if (m.kind === 'belt' && state.items.has(key)) return { key, machine: m, kind: 'belt' }
    if (m.kind === 'spawner' && spawnerDue(m, tick)) return { key, machine: m, kind: 'spawner' }
  }
  return null
}

/** In M3 only belts carry/receive items (storage, seller, etc. arrive later). */
function isReceiver(state: SimState, key: string): boolean {
  return state.machines.get(key)?.kind === 'belt'
}

/**
 * Advances the simulation by one tick, returning a new state. `machines` is
 * returned by reference (unchanged in M3); a fresh `items` map is produced.
 */
export function step(state: SimState): SimState {
  const tick = state.tick + 1
  const { machines, items } = state

  // Memoized recursion: does the item currently at `key` leave this tick?
  const movingMemo = new Map<string, boolean>()
  const inProgress = new Set<string>()

  const willBeEmpty = (key: string): boolean => (!items.has(key) ? true : moves(key))

  function moves(key: string): boolean {
    const memo = movingMemo.get(key)
    if (memo !== undefined) return memo
    if (!items.has(key)) return false
    const m = machines.get(key)
    if (!m || m.kind !== 'belt') {
      movingMemo.set(key, false)
      return false
    }
    if (inProgress.has(key)) return false // cycle guard: undecided → treat as staying
    inProgress.add(key)

    const { dx, dy } = dirDelta(m.dir)
    const tx = m.x + dx
    const ty = m.y + dy
    const targetKey = cellKey(tx, ty)

    let result = false
    if (isReceiver(state, targetKey) && willBeEmpty(targetKey)) {
      result = winningSource(state, tx, ty, tick)?.key === key
    }

    inProgress.delete(key)
    movingMemo.set(key, result)
    return result
  }

  const next = new Map<string, string>()

  // 1. Items that do not move stay put.
  for (const [key, type] of items) {
    if (!moves(key)) next.set(key, type)
  }

  // 2. Fill each belt cell that will be empty with its winning source (a moving
  //    upstream item, or a due spawner's fresh item).
  for (const m of machines.values()) {
    if (m.kind !== 'belt') continue
    const targetKey = cellKey(m.x, m.y)
    if (next.has(targetKey)) continue
    if (!willBeEmpty(targetKey)) continue

    const winner = winningSource(state, m.x, m.y, tick)
    if (!winner) continue

    if (winner.kind === 'belt') {
      const type = items.get(winner.key)
      if (type !== undefined && moves(winner.key)) next.set(targetKey, type)
    } else {
      const entry = CATALOG_BY_ID[winner.machine.catalogId]
      if (entry?.outputItem) next.set(targetKey, entry.outputItem)
    }
  }

  return { machines, items: next, tick }
}
