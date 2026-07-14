import type { Dir, Machine } from './types'
import { cellKey, dirDelta, nextDir } from './world'
import { basePrice, categoryOf, CATALOG_BY_ID, combinerOutput, processorOutput, storageCapacity } from '../data'
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
//
// Storage is both a sink and a source: it accepts items from any neighbour
// pointing into it, and while it holds stock it offers one item per tick out of
// its facing side. A belt (or processor, combiner, seller, another storage)
// placed on that side pulls the stockpile back out, so chests can be chained.
//
// A splitter carries a single item (like a belt) pulled in from directly behind
// it (opposite its facing). It offers that item out of its three non-input sides
// — forward, and the two perpendiculars — in round-robin order, so a saturated
// input fans out evenly across whichever of those sides have a willing consumer.
// Sides with nothing to receive them are skipped, and the rotation only advances
// when the item actually leaves.

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

/** A town hall's banked villagers, keyed by villager item id → count consumed. */
export type TownHallState = Record<string, number>

/** The simulation state. `machines` is read-only; the rest is rebuilt per tick. */
export interface SimState {
  machines: Map<string, Machine>
  /** cell key → item type id (a belt cell holds at most one item). */
  items: Map<string, string>
  /** cell key → internal buffer, for processor/combiner cells only. */
  buffers: Map<string, MachineBuffer>
  /** cell key → contents, for storage cells only (M5). */
  stores: Map<string, StorageState>
  /** cell key → banked villagers, for town hall cells only. Persisted. */
  townHalls: Map<string, TownHallState>
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
  /**
   * cell key → round-robin cursor (0..2) for splitter cells, indexing the next
   * output side to try. Transient like `items`/`buffers`; absent maps default to
   * 0, so it need not be seeded or persisted.
   */
  splitterCursors?: Map<string, number>
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

// A village's three input sides, one per requirement, given its output facing:
// [food, drink, bed] = [directly behind, clockwise-perpendicular, the other
// perpendicular]. Facing E → food from W (behind), drink from S, bed from N.
function villageInputDirs(dir: Dir): [Dir, Dir, Dir] {
  const cw = nextDir(dir)
  return [OPPOSITE[dir], cw, nextDir(nextDir(cw))]
}

// The village recipe's per-slot requirement check: slot 0 accepts any `food`
// item, slot 1 any `drink`, slot 2 the exact `bed` item id (all from config).
function villageSlotAccepts(slot: number, item: string): boolean {
  const r = config.villageRecipe
  if (slot === 0) return categoryOf(item) === r.food
  if (slot === 1) return categoryOf(item) === r.drink
  if (slot === 2) return item === r.bed
  return false
}

// A splitter takes input from directly behind (opposite `dir`) and offers its
// item out of the other three sides. This is the fixed rotation order the
// round-robin cursor walks: forward, then clockwise, then anticlockwise.
function splitterOutputOrder(dir: Dir): [Dir, Dir, Dir] {
  const cw = nextDir(dir)
  return [dir, cw, nextDir(nextDir(cw))]
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
  const { machines, items, buffers, stores, townHalls, sellerBuffers, prices, online } = state
  const splitterCursors = state.splitterCursors ?? new Map<string, number>()

  const buf = (key: string): MachineBuffer | undefined => buffers.get(key)

  /** Does the machine at `key` currently have an item/output ready to send? */
  const readyToEmit = (key: string): boolean => {
    const m = machines.get(key)
    if (!m) return false
    switch (m.kind) {
      case 'belt':
      case 'splitter':
        return items.has(key)
      case 'spawner':
        return spawnerDue(m, tick)
      case 'processor':
      case 'combiner':
      case 'village':
        return buf(key)?.out != null
      case 'storage':
        return (stores.get(key)?.count ?? 0) > 0
      default:
        return false // sellers only consume
    }
  }

  /** The item value a ready machine at `key` would send this tick. */
  const emittedValue = (key: string): string | undefined => {
    const m = machines.get(key)
    if (!m) return undefined
    switch (m.kind) {
      case 'belt':
      case 'splitter':
        return items.get(key)
      case 'spawner':
        return CATALOG_BY_ID[m.catalogId]?.outputItem
      case 'processor':
      case 'combiner':
      case 'village':
        return buf(key)?.out ?? undefined
      case 'storage':
        return stores.get(key)?.item ?? undefined
      default:
        return undefined
    }
  }

  // The side a machine at `key` is currently emitting out of. For most kinds
  // that is simply their fixed facing; a splitter's varies per tick with its
  // round-robin choice (null when it has nothing to send or every side is
  // blocked), so all feeder matching goes through here rather than `m.dir`.
  const sourceOutDir = (m: Machine, key: string): Dir | null =>
    m.kind === 'splitter' ? splitterChosenDir(key) : m.dir

  // The single winning source that will feed target cell (tx,ty) this tick, by
  // fixed N,E,S,W priority among neighbours that point in and are ready. Used for
  // any single-input sink (belt, storage, seller).
  const winningFeeder = (tx: number, ty: number): string | null => {
    for (const nb of INCOMING) {
      const key = cellKey(tx + nb.dx, ty + nb.dy)
      const m = machines.get(key)
      if (!m || sourceOutDir(m, key) !== nb.out) continue
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
    return nb && sourceOutDir(nb, key) === m.dir && readyToEmit(key) ? key : null
  }

  // A combiner's slot-`slot` feeder: the neighbour on that input side, pointing
  // inward and ready.
  const combinerFeeder = (m: Machine, slot: 0 | 1): string | null => {
    const sideDir = inputDirs(m.dir)[slot]
    const { dx, dy } = dirDelta(sideDir)
    const key = cellKey(m.x + dx, m.y + dy)
    const nb = machines.get(key)
    return nb && sourceOutDir(nb, key) === OPPOSITE[sideDir] && readyToEmit(key) ? key : null
  }

  const combinerSlotForFeeder = (m: Machine, fromKey: string): 0 | 1 | -1 => {
    if (combinerFeeder(m, 0) === fromKey) return 0
    if (combinerFeeder(m, 1) === fromKey) return 1
    return -1
  }

  // A village's slot-`slot` feeder: the neighbour on that input side, pointing
  // inward and ready. Mirrors combinerFeeder but over three sides.
  const villageFeeder = (m: Machine, slot: 0 | 1 | 2): string | null => {
    const sideDir = villageInputDirs(m.dir)[slot]
    const { dx, dy } = dirDelta(sideDir)
    const key = cellKey(m.x + dx, m.y + dy)
    const nb = machines.get(key)
    return nb && sourceOutDir(nb, key) === OPPOSITE[sideDir] && readyToEmit(key) ? key : null
  }

  const villageSlotForFeeder = (m: Machine, fromKey: string): 0 | 1 | 2 | -1 => {
    if (villageFeeder(m, 0) === fromKey) return 0
    if (villageFeeder(m, 1) === fromKey) return 1
    if (villageFeeder(m, 2) === fromKey) return 2
    return -1
  }

  // Memoized recursion: does the item/output at `key` leave its cell this tick?
  // Mutually recursive with `accepts` (a source emits only if its target has
  // room, which for a belt depends on that belt's own item leaving).
  const emitMemo = new Map<string, boolean>()
  const inProgress = new Set<string>()

  // Memoized round-robin resolution for a splitter: the output side its held
  // item will leave through this tick, or null if it has no item or every
  // candidate side is blocked. Sides are tried from the cursor onward and the
  // first whose neighbour accepts wins. While a side is under test,
  // `chosenInProgress` holds it so that a downstream acceptance check which loops
  // back through this splitter (via winningFeeder → sourceOutDir) sees the same
  // facing instead of recursing forever.
  const chosenMemo = new Map<string, Dir | null>()
  const chosenInProgress = new Map<string, Dir>()

  function splitterChosenDir(key: string): Dir | null {
    const memo = chosenMemo.get(key)
    if (memo !== undefined) return memo
    const tentative = chosenInProgress.get(key)
    if (tentative !== undefined) return tentative
    const m = machines.get(key)
    if (!m || !items.has(key)) {
      chosenMemo.set(key, null)
      return null
    }
    const order = splitterOutputOrder(m.dir)
    const start = splitterCursors.get(key) ?? 0
    for (let i = 0; i < order.length; i++) {
      const side = order[(start + i) % order.length]
      chosenInProgress.set(key, side)
      const { dx, dy } = dirDelta(side)
      const ok = accepts(cellKey(m.x + dx, m.y + dy), key)
      chosenInProgress.delete(key)
      if (ok) {
        chosenMemo.set(key, side)
        return side
      }
    }
    chosenMemo.set(key, null)
    return null
  }

  function willEmit(key: string): boolean {
    const memo = emitMemo.get(key)
    if (memo !== undefined) return memo
    if (!readyToEmit(key)) {
      emitMemo.set(key, false)
      return false
    }
    const m = machines.get(key)!
    // Splitters resolve their own emission via the round-robin scan above, which
    // is separately memoized; keep them out of the emitMemo/inProgress path.
    if (m.kind === 'splitter') return splitterChosenDir(key) != null
    if (inProgress.has(key)) return false // cycle guard: undecided → treat as staying
    inProgress.add(key)

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
      case 'village': {
        // Accept only if the feeder sits on an input side AND its item satisfies
        // that side's requirement (food/drink category, or the bed item). A
        // mismatch is rejected — it back-pressures rather than becoming junk.
        const slot = villageSlotForFeeder(tm, fromKey)
        if (slot < 0) return false
        const incoming = emittedValue(fromKey)
        if (incoming === undefined || !villageSlotAccepts(slot, incoming)) return false
        return villageSlotFree(targetKey, slot)
      }
      case 'storage': {
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        const store = stores.get(targetKey)
        const incoming = emittedValue(fromKey)
        if (incoming === undefined) return false
        const locked = store?.item ?? null
        if (locked !== null && locked !== incoming) return false // wrong type → reject
        const count = store?.count ?? 0
        // Room now, or a full store whose own emission clears a slot this tick.
        return count < storageCapacity(tm.catalogId) || willEmit(targetKey)
      }
      case 'splitter': {
        // A splitter only draws from directly behind it; it has room when it is
        // empty, or its current item leaves this tick to free the cell.
        if (backFeeder(tm) !== fromKey) return false
        return !items.has(targetKey) || willEmit(targetKey)
      }
      case 'seller':
        // A seller always consumes its winning feeder's item: online it is banked
        // on build, offline it is buffered (M9) so nothing is lost while away.
        return winningFeeder(tm.x, tm.y) === fromKey
      case 'townhall': {
        // A sink like the seller, but only for villagers: it banks them by type.
        // A non-villager on its feeder is rejected (back-pressures) instead of
        // being silently eaten.
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        const incoming = emittedValue(fromKey)
        return incoming !== undefined && categoryOf(incoming) === 'villager'
      }
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

  // A village input slot has room if empty, or all three slots are full and the
  // output will clear (letting the trio combine into a villager and free them).
  function villageSlotFree(key: string, slot: number): boolean {
    const b = buf(key)
    if (!b || b.in[slot] == null) return true
    const full = b.in[0] != null && b.in[1] != null && b.in[2] != null
    return full && (b.out == null || willEmit(key))
  }

  const nextItems = new Map<string, string>()
  const nextBuffers = new Map<string, MachineBuffer>()
  const nextStores = new Map<string, StorageState>()
  // Town halls persist and only grow, so keep the same map reference unless a
  // villager is actually banked this tick (clone-on-write below). Callers can
  // cheaply detect "no change" by identity to skip recomputing town bonuses.
  let nextTownHalls = townHalls
  const nextSellerBuffers = new Map<string, Record<string, number>>(sellerBuffers)
  const nextSplitterCursors = new Map<string, number>()
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
      case 'splitter': {
        const chosen = splitterChosenDir(key)
        const emits = chosen != null
        // Keep the held item unless it leaves; a cleared splitter may take a new
        // one from behind this same tick (matching the belt hand-off).
        let value = items.has(key) && !emits ? items.get(key) : undefined
        const feeder = backFeeder(m)
        if (feeder && willEmit(feeder)) value = emittedValue(feeder) ?? value
        if (value !== undefined) nextItems.set(key, value)
        // Advance the cursor past the side just used so the next item prefers a
        // different side; otherwise carry the current cursor forward unchanged.
        const cursor = splitterCursors.get(key) ?? 0
        if (emits) {
          const order = splitterOutputOrder(m.dir)
          nextSplitterCursors.set(key, (order.indexOf(chosen) + 1) % order.length)
        } else if (cursor !== 0) {
          nextSplitterCursors.set(key, cursor)
        }
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
      case 'village': {
        // Three input slots (food, drink, bed); once all are filled they combine
        // into a villager. Same fill/consume/emit dance as the combiner.
        const b = buf(key) ?? { in: [null, null, null], out: null }
        const emit = willEmit(key)
        const full = b.in[0] != null && b.in[1] != null && b.in[2] != null
        const consumes = full && (b.out == null || emit)
        const out = consumes ? config.villageRecipe.output : emit ? null : b.out
        const next: (string | null)[] = consumes ? [null, null, null] : [b.in[0], b.in[1], b.in[2]]
        for (const slot of [0, 1, 2] as const) {
          const feeder = villageFeeder(m, slot)
          if (feeder && willEmit(feeder)) next[slot] = emittedValue(feeder) ?? next[slot]
        }
        if (next.some((s) => s != null) || out != null) nextBuffers.set(key, { in: next, out })
        break
      }
      case 'storage': {
        const store = stores.get(key)
        let item = store?.item ?? null
        let count = store?.count ?? 0
        if (willEmit(key)) count -= 1 // one item pulled out of the facing side
        const incoming = arrivingItem(m.x, m.y)
        if (incoming !== undefined) {
          item = item ?? incoming // lock onto the first type received
          count += 1
        }
        // Drained empty → drop the entry, clearing the type lock (as Sell-All does).
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
      case 'townhall': {
        // Bank an arriving villager into this hall's per-type tally (clone the
        // town-halls map on first write so unchanged ticks keep their reference).
        const incoming = arrivingItem(m.x, m.y)
        if (incoming !== undefined) {
          if (nextTownHalls === townHalls) nextTownHalls = new Map(townHalls)
          const prev = nextTownHalls.get(key) ?? {}
          nextTownHalls.set(key, { ...prev, [incoming]: (prev[incoming] ?? 0) + 1 })
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
    townHalls: nextTownHalls,
    sellerBuffers: nextSellerBuffers,
    splitterCursors: nextSplitterCursors,
    money,
    prices,
    online,
    tick,
  }
}
