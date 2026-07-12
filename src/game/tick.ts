import type { Dir, Machine } from './types'
import { cellKey, dirDelta } from './world'
import { basePrice, CATALOG_BY_ID, combinerOutput, processorOutput, storageCapacity } from '../data'
import { config } from '../data/config'

// The simulation is a pure `step(state) -> state` function over next-state
// buffers, so it can be driven live at a fixed tick and also run headlessly in a
// loop (reused for offline catch-up in M9). It never mutates its input.
//
// Movement uses a PULL model unified across machine kinds: an item advances into
// a downstream cell only if that cell will have room this tick and this item
// wins it. This makes packed belts advance as a unit, applies back-pressure when
// a head is blocked (nothing is dropped or duplicated), and resolves merges into
// a belt deterministically by fixed source priority N, E, S, W.
//
// Belts carry a single item on their cell. Processors and combiners instead hold
// items in internal buffers (M4): a processor pulls from the cell directly
// behind it, transforms it (1→1) and emits ahead, holding if the output is
// blocked; a combiner pulls one item into each of its two perpendicular input
// sides, and once both are filled emits the combined output (order-independent),
// again holding if blocked. Any input a processor can't transform, or any pair a
// combiner can't combine, becomes the configured "junk" item.

/** Internal item storage for a processing machine (processor/combiner). */
export interface MachineBuffer {
  /** Input slots: processors have one; combiners have two (one per input side). */
  in: (string | null)[]
  /** Output hold: a transformed/combined item waiting to be pushed out. */
  out: string | null
}

/** A storage machine's contents: it locks onto the first item type it receives. */
export interface StorageState {
  /** The locked item type, or null while the storage is still empty. */
  item: string | null
  count: number
}

/** The simulation state. `machines` is read-only; the rest is rebuilt per tick. */
export interface SimState {
  machines: Map<string, Machine>
  /** cell key → item type id (a belt cell holds at most one item). */
  items: Map<string, string>
  /** cell key → internal buffer, for processor/combiner cells only. */
  buffers: Map<string, MachineBuffer>
  /** cell key → contents, for storage cells only (M5). */
  stores: Map<string, StorageState>
  /**
   * cell key → { itemId: count } consumed by an offline seller (M9). Only
   * written while `online` is false; used by offline catch-up to measure seller
   * throughput. Empty during live play.
   */
  sellerBuffers: Map<string, Record<string, number>>
  /** Bank balance; auto-sellers credit it while online (M5). */
  money: number
  /** Live sale price per item id (from the market, M7); base price if absent. */
  prices: Record<string, number>
  /** Whether live selling is active. Offline (M9) sellers buffer instead. */
  online: boolean
  /** Monotonic tick counter. */
  tick: number
}

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' }

// Neighbours of a target belt cell, in fixed priority order N, E, S, W, paired
// with the output direction a machine in that neighbour must face to feed it.
const INCOMING: { dx: number; dy: number; out: Dir }[] = [
  { dx: 0, dy: -1, out: 'S' }, // north neighbour, pointing south
  { dx: 1, dy: 0, out: 'W' }, // east neighbour, pointing west
  { dx: 0, dy: 1, out: 'N' }, // south neighbour, pointing north
  { dx: -1, dy: 0, out: 'E' }, // west neighbour, pointing east
]

/** A combiner's two input sides (slot 0, slot 1), given its output direction. */
function inputDirs(outputDir: Dir): [Dir, Dir] {
  return outputDir === 'E' || outputDir === 'W' ? ['N', 'S'] : ['E', 'W']
}

/** Whether a spawner is due to emit on a given tick. */
function spawnerDue(machine: Machine, tick: number): boolean {
  const entry = CATALOG_BY_ID[machine.catalogId]
  if (!entry || !entry.outputItem || !entry.rateTicks || entry.rateTicks <= 0) return false
  return tick % entry.rateTicks === 0
}

/** Junk fallbacks: any un-transformable input still produces a (junk) item. */
function transformProcessor(input: string): string {
  return processorOutput(input) ?? config.junkItemId
}
function combine(a: string, b: string): string {
  return combinerOutput(a, b) ?? config.junkItemId
}

/**
 * Advances the simulation by one tick, returning a new state. `machines` is
 * returned by reference (unchanged); fresh `items` and `buffers` maps are built.
 */
export function step(state: SimState): SimState {
  const tick = state.tick + 1
  const { machines, items, buffers, stores, sellerBuffers, prices, online } = state

  const buf = (key: string): MachineBuffer | undefined => buffers.get(key)

  /** Does the machine at `key` currently have an item/output ready to send? */
  const readyToEmit = (key: string): boolean => {
    const m = machines.get(key)
    if (!m) return false
    switch (m.kind) {
      case 'belt':
        return items.has(key)
      case 'spawner':
        return spawnerDue(m, tick)
      case 'processor':
      case 'combiner':
        return buf(key)?.out != null
      default:
        return false // storage/seller are not emitters (M5)
    }
  }

  /** The item value a ready machine at `key` would send this tick. */
  const emittedValue = (key: string): string | undefined => {
    const m = machines.get(key)
    if (!m) return undefined
    switch (m.kind) {
      case 'belt':
        return items.get(key)
      case 'spawner':
        return CATALOG_BY_ID[m.catalogId]?.outputItem
      case 'processor':
      case 'combiner':
        return buf(key)?.out ?? undefined
      default:
        return undefined
    }
  }

  // The single winning source that will feed target cell (tx,ty) this tick, by
  // fixed N,E,S,W priority among neighbours that point in and are ready. Used for
  // any single-input sink (belt, storage, seller).
  const winningFeeder = (tx: number, ty: number): string | null => {
    for (const nb of INCOMING) {
      const key = cellKey(tx + nb.dx, ty + nb.dy)
      const m = machines.get(key)
      if (!m || m.dir !== nb.out) continue
      if (readyToEmit(key)) return key
    }
    return null
  }

  // A processor's input is the cell directly behind it (opposite its facing);
  // that neighbour must point into the processor (same facing) and be ready.
  const backFeeder = (m: Machine): string | null => {
    const { dx, dy } = dirDelta(OPPOSITE[m.dir])
    const key = cellKey(m.x + dx, m.y + dy)
    const nb = machines.get(key)
    return nb && nb.dir === m.dir && readyToEmit(key) ? key : null
  }

  // A combiner's slot-`slot` feeder: the neighbour on that input side, pointing
  // inward and ready.
  const combinerFeeder = (m: Machine, slot: 0 | 1): string | null => {
    const sideDir = inputDirs(m.dir)[slot]
    const { dx, dy } = dirDelta(sideDir)
    const key = cellKey(m.x + dx, m.y + dy)
    const nb = machines.get(key)
    return nb && nb.dir === OPPOSITE[sideDir] && readyToEmit(key) ? key : null
  }

  const combinerSlotForFeeder = (m: Machine, fromKey: string): 0 | 1 | -1 => {
    if (combinerFeeder(m, 0) === fromKey) return 0
    if (combinerFeeder(m, 1) === fromKey) return 1
    return -1
  }

  // Memoized recursion: does the item/output at `key` leave its cell this tick?
  // Mutually recursive with `accepts` (a source emits only if its target has
  // room, which for a belt depends on that belt's own item leaving).
  const emitMemo = new Map<string, boolean>()
  const inProgress = new Set<string>()

  function willEmit(key: string): boolean {
    const memo = emitMemo.get(key)
    if (memo !== undefined) return memo
    if (!readyToEmit(key)) {
      emitMemo.set(key, false)
      return false
    }
    if (inProgress.has(key)) return false // cycle guard: undecided → treat as staying
    inProgress.add(key)

    const m = machines.get(key)!
    const { dx, dy } = dirDelta(m.dir)
    const result = accepts(cellKey(m.x + dx, m.y + dy), key)

    inProgress.delete(key)
    emitMemo.set(key, result)
    return result
  }

  /** Will the cell at `targetKey` receive the item coming from `fromKey`? */
  function accepts(targetKey: string, fromKey: string): boolean {
    const tm = machines.get(targetKey)
    if (!tm) return false
    switch (tm.kind) {
      case 'belt':
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        return !items.has(targetKey) || willEmit(targetKey)
      case 'processor':
        if (backFeeder(tm) !== fromKey) return false
        return processorInputFree(targetKey)
      case 'combiner': {
        const slot = combinerSlotForFeeder(tm, fromKey)
        return slot >= 0 && combinerSlotFree(targetKey, slot)
      }
      case 'storage': {
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        const store = stores.get(targetKey)
        const incoming = emittedValue(fromKey)
        if (incoming === undefined) return false
        const locked = store?.item ?? null
        if (locked !== null && locked !== incoming) return false // wrong type → reject
        const count = store?.count ?? 0
        return count < storageCapacity(tm.catalogId)
      }
      case 'seller':
        // A seller always consumes its winning feeder's item: online it is banked
        // on build, offline it is buffered (M9) so nothing is lost while away.
        return winningFeeder(tm.x, tm.y) === fromKey
      default:
        return false
    }
  }

  // A processor's input slot has room this tick if it is empty, or its held
  // output will clear (letting the current input transform and free the slot).
  function processorInputFree(key: string): boolean {
    const b = buf(key)
    if (!b || b.in[0] == null || b.out == null) return true
    return willEmit(key)
  }

  // A combiner input slot has room if empty, or both slots are full and the
  // output will clear (letting the pair combine and free both slots).
  function combinerSlotFree(key: string, slot: number): boolean {
    const b = buf(key)
    if (!b || b.in[slot] == null) return true
    return b.in[0] != null && b.in[1] != null && (b.out == null || willEmit(key))
  }

  const nextItems = new Map<string, string>()
  const nextBuffers = new Map<string, MachineBuffer>()
  const nextStores = new Map<string, StorageState>()
  const nextSellerBuffers = new Map<string, Record<string, number>>(sellerBuffers)
  let money = state.money

  // The item (if any) that will actually arrive into single-input sink `key`.
  const arrivingItem = (tx: number, ty: number): string | undefined => {
    const winner = winningFeeder(tx, ty)
    return winner && willEmit(winner) ? emittedValue(winner) : undefined
  }

  for (const m of machines.values()) {
    const key = cellKey(m.x, m.y)
    switch (m.kind) {
      case 'belt': {
        // Keep a held item; a belt that clears may receive a fresh one.
        let value = items.has(key) && !willEmit(key) ? items.get(key) : undefined
        const incoming = arrivingItem(m.x, m.y)
        if (incoming !== undefined) value = incoming
        if (value !== undefined) nextItems.set(key, value)
        break
      }
      case 'processor': {
        const b = buf(key) ?? { in: [null], out: null }
        const emit = willEmit(key)
        // Consume (transform) the input when the output slot is/will be free.
        const consumes = b.in[0] != null && (b.out == null || emit)
        const out = consumes ? transformProcessor(b.in[0]!) : emit ? null : b.out
        let in0: string | null = consumes ? null : b.in[0]
        const feeder = backFeeder(m)
        if (feeder && willEmit(feeder)) in0 = emittedValue(feeder) ?? in0
        if (in0 != null || out != null) nextBuffers.set(key, { in: [in0], out })
        break
      }
      case 'combiner': {
        const b = buf(key) ?? { in: [null, null], out: null }
        const emit = willEmit(key)
        const consumes = b.in[0] != null && b.in[1] != null && (b.out == null || emit)
        const out = consumes ? combine(b.in[0]!, b.in[1]!) : emit ? null : b.out
        const next: [string | null, string | null] = [
          consumes ? null : b.in[0],
          consumes ? null : b.in[1],
        ]
        for (const slot of [0, 1] as const) {
          const feeder = combinerFeeder(m, slot)
          if (feeder && willEmit(feeder)) next[slot] = emittedValue(feeder) ?? next[slot]
        }
        if (next[0] != null || next[1] != null || out != null) {
          nextBuffers.set(key, { in: next, out })
        }
        break
      }
      case 'storage': {
        const store = stores.get(key)
        let item = store?.item ?? null
        let count = store?.count ?? 0
        const incoming = arrivingItem(m.x, m.y)
        if (incoming !== undefined) {
          item = item ?? incoming // lock onto the first type received
          count += 1
        }
        if (item !== null && count > 0) nextStores.set(key, { item, count })
        break
      }
      case 'seller': {
        const incoming = arrivingItem(m.x, m.y)
        if (incoming !== undefined) {
          if (online) {
            // Liquidate at the live market price (base price if the market has none).
            money += prices[incoming] ?? basePrice(incoming)
          } else {
            // Offline: buffer intake per item so catch-up can measure throughput.
            const prev = nextSellerBuffers.get(key) ?? {}
            nextSellerBuffers.set(key, { ...prev, [incoming]: (prev[incoming] ?? 0) + 1 })
          }
        }
        break
      }
      // spawner: emits into neighbours but stores nothing itself.
    }
  }

  return {
    machines,
    items: nextItems,
    buffers: nextBuffers,
    stores: nextStores,
    sellerBuffers: nextSellerBuffers,
    money,
    prices,
    online,
    tick,
  }
}
