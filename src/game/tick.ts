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
//
// A crossover carries up to TWO items at once — one on its vertical (N–S) lane
// and one on its horizontal (E–W) lane — so two production lines can cross the
// same cell without mixing. Each lane is feeder-inferred: whichever axis-end
// neighbour points in is the input, and the item exits the OPPOSITE end (carrying
// that exit side with it until it leaves). The lanes are independent, so a jam on
// one never stalls the other. If BOTH ends of an axis point in (two lines aimed
// head-on), that lane has no valid exit for either — it refuses input and both
// feeders back up, exactly like any blocked belt (no item is dropped).

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

/** One lane of a crossover: the item riding it and the side it will exit. */
export interface CrossoverLane {
  item: string
  /** The side this item leaves through (N/S on the vertical lane, E/W on the horizontal). */
  out: Dir
}

/**
 * A crossover's two independent lanes. `v` is the vertical (N–S) lane, `h` the
 * horizontal (E–W) lane; either is null when that lane is empty. Transient (like
 * belt `items`) — never persisted, and cleared on offline catch-up.
 */
export interface CrossoverState {
  v: CrossoverLane | null
  h: CrossoverLane | null
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
  /**
   * Items sold by auto-sellers THIS tick, keyed by item id → count. Only written
   * while `online` (offline sales buffer into `sellerBuffers` instead), and only
   * consumed downstream by the bounty board's `sell` objectives — the sim itself
   * doesn't read it back. Absent/empty on ticks with no live sale.
   */
  sold?: Map<string, number>
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
  /**
   * cell key → lane contents for crossover cells. Transient like `items`;
   * absent maps default to empty, so it need not be seeded or persisted.
   */
  crossovers?: Map<string, CrossoverState>
  /**
   * channel label → FIFO queue of item ids in transit between teleporter pads.
   * Send pads enqueue at the back; receive pads on the same channel dequeue from
   * the front. Transient like `items`/`crossovers` (absent maps default to
   * empty, so it need not be seeded or persisted). The 1-tick hand-off — items
   * enqueued this tick are only visible to receivers next tick — is what keeps
   * teleporters out of the same-tick movement recursion.
   */
  transit?: Map<string, string[]>
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

/** Which crossover lane a direction belongs to: N/S ride the vertical lane, E/W the horizontal. */
function laneFor(dir: Dir): 'v' | 'h' {
  return dir === 'N' || dir === 'S' ? 'v' : 'h'
}

/** The cardinal direction from cell A to cell B if they are orthogonally adjacent, else null. */
function dirBetween(ax: number, ay: number, bx: number, by: number): Dir | null {
  if (bx === ax && by === ay - 1) return 'N'
  if (bx === ax + 1 && by === ay) return 'E'
  if (bx === ax && by === ay + 1) return 'S'
  if (bx === ax - 1 && by === ay) return 'W'
  return null
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

/** A teleporter pad's role (send/receive), read from its catalog entry. */
function teleporterRole(catalogId: string): 'send' | 'receive' | undefined {
  return CATALOG_BY_ID[catalogId]?.role
}

/**
 * Canonical channel key for a teleporter pad: trimmed and lower-cased so `" Coal "`
 * and `"coal"` link, and empty (unlinked) becomes null. All channel lookups go
 * through this so the matching rule lives in one place.
 */
function normalizeChannel(channel: string | undefined): string | null {
  if (!channel) return null
  const c = channel.trim().toLowerCase()
  return c.length > 0 ? c : null
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
  const crossovers = state.crossovers ?? new Map<string, CrossoverState>()
  const transit = state.transit ?? new Map<string, string[]>()

  const buf = (key: string): MachineBuffer | undefined => buffers.get(key)

  // Group receive (output) pads by channel so a channel with several outputs can
  // split its queue evenly across them. Each pad's cell key gets its stable index
  // and the network size; the index + a per-tick rotation decide which queue slot
  // that pad claims this tick (see `receiverClaim`), so every output's decision is
  // independent — no two claim the same item.
  const receiversByChannel = new Map<string, string[]>()
  for (const m of machines.values()) {
    if (m.kind !== 'teleporter' || teleporterRole(m.catalogId) !== 'receive') continue
    const ch = normalizeChannel(m.channel)
    if (!ch) continue
    const list = receiversByChannel.get(ch)
    if (list) list.push(cellKey(m.x, m.y))
    else receiversByChannel.set(ch, [cellKey(m.x, m.y)])
  }
  const receiverInfo = new Map<string, { ch: string; index: number; size: number }>()
  for (const [ch, keys] of receiversByChannel) {
    keys.sort() // deterministic order → stable slot assignment across ticks
    keys.forEach((k, index) => receiverInfo.set(k, { ch, index, size: keys.length }))
  }

  // The queue item (if any) a receive pad at `key` is entitled to emit this tick.
  // Its rank in the rotated output order (rotation = tick % size) is the queue
  // index it owns; it holds a claim only while that index is within the queue.
  // Rotating by tick makes "who gets the front" cycle, so a scarce queue is shared
  // evenly and a blocked output frees its slot for another next tick.
  const receiverClaim = (key: string): string | undefined => {
    const info = receiverInfo.get(key)
    if (!info) return undefined
    const q = transit.get(info.ch)
    if (!q || q.length === 0) return undefined
    const rank = (info.index - (tick % info.size) + info.size) % info.size
    return rank < q.length ? q[rank] : undefined
  }

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
      case 'teleporter':
        // Only the receive pad emits (from its channel queue); the send pad is a
        // pure sink, so it never has anything of its own to send.
        return teleporterRole(m.catalogId) === 'receive' && receiverClaim(key) !== undefined
      default:
        return false // sellers only consume
    }
  }

  // The item (if any) a crossover at `key` is offering out of side `dir`: the
  // lane on that axis, but only when its held item's stored exit matches `dir`
  // (an item bound for the far end is not being offered out of the near one).
  const crossoverOut = (key: string, dir: Dir): string | undefined => {
    const cs = crossovers.get(key)
    if (!cs) return undefined
    const lane = laneFor(dir) === 'v' ? cs.v : cs.h
    return lane && lane.out === dir ? lane.item : undefined
  }

  // Direction-aware source query: is the machine at `key` offering an item out of
  // side `dir` this tick? Unifies "has something to send" with "faces that way",
  // so a crossover (a distinct item per lane) and a splitter (one item out of its
  // round-robin-chosen side) are matched by the side a consumer sees, not by a
  // single fixed `m.dir`.
  const readyOut = (key: string, dir: Dir): boolean => {
    const m = machines.get(key)
    if (!m) return false
    switch (m.kind) {
      case 'belt':
        return m.dir === dir && items.has(key)
      case 'splitter':
        return splitterChosenDir(key) === dir
      case 'spawner':
        return m.dir === dir && spawnerDue(m, tick)
      case 'processor':
      case 'combiner':
      case 'village':
        return m.dir === dir && buf(key)?.out != null
      case 'storage':
        return m.dir === dir && (stores.get(key)?.count ?? 0) > 0
      case 'crossover':
        return crossoverOut(key, dir) !== undefined
      case 'teleporter':
        return m.dir === dir && teleporterRole(m.catalogId) === 'receive' && receiverClaim(key) !== undefined
      default:
        return false // sellers / town halls only consume
    }
  }

  // The item value a source at `key` would send out of side `dir`. Callers gate
  // on `readyOut` first, so for single-output kinds `dir` already matches; only a
  // crossover needs it to pick the right lane.
  const valueOut = (key: string, dir: Dir): string | undefined => {
    const m = machines.get(key)
    if (!m) return undefined
    switch (m.kind) {
      case 'crossover':
        return crossoverOut(key, dir)
      case 'spawner':
        return CATALOG_BY_ID[m.catalogId]?.outputItem
      case 'processor':
      case 'combiner':
      case 'village':
        return buf(key)?.out ?? undefined
      case 'storage':
        return stores.get(key)?.item ?? undefined
      case 'teleporter':
        return receiverClaim(key) // undefined for a send pad (no claim)
      default:
        return items.get(key) // belt / splitter carry a single cell item
    }
  }

  // Will the item a source at `key` offers out of side `dir` actually leave this
  // tick (the downstream cell accepts it)? Mirrors `willEmit` but per-side, so a
  // crossover lane and a splitter's chosen side resolve independently.
  const willLeaveOut = (key: string, dir: Dir): boolean => {
    const m = machines.get(key)
    if (!m) return false
    if (m.kind === 'crossover') return crossoverWillLeave(key, dir)
    if (m.kind === 'splitter') return splitterChosenDir(key) === dir
    return m.dir === dir && willEmit(key)
  }

  // The value that would arrive at sink `tm` from `fromKey` this tick — resolves
  // the direction the source emits toward the sink so a crossover feeder picks
  // the right lane.
  const incomingValue = (fromKey: string, tm: Machine): string | undefined => {
    const fm = machines.get(fromKey)
    if (!fm) return undefined
    const dir = dirBetween(fm.x, fm.y, tm.x, tm.y)
    return dir ? valueOut(fromKey, dir) : undefined
  }

  // The single winning source that will feed target cell (tx,ty) this tick, by
  // fixed N,E,S,W priority among neighbours that offer an item toward it. Used
  // for any single-input sink (belt, storage, seller, town hall).
  const winningFeeder = (tx: number, ty: number): string | null => {
    for (const nb of INCOMING) {
      const key = cellKey(tx + nb.dx, ty + nb.dy)
      if (readyOut(key, nb.out)) return key
    }
    return null
  }

  // A processor/splitter's input is the cell directly behind it (opposite its
  // facing); that neighbour must offer an item toward the machine (same facing).
  const backFeeder = (m: Machine): string | null => {
    const { dx, dy } = dirDelta(OPPOSITE[m.dir])
    const key = cellKey(m.x + dx, m.y + dy)
    return readyOut(key, m.dir) ? key : null
  }

  // A combiner's slot-`slot` feeder: the neighbour on that input side offering an
  // item inward (toward the combiner).
  const combinerFeeder = (m: Machine, slot: 0 | 1): string | null => {
    const sideDir = inputDirs(m.dir)[slot]
    const { dx, dy } = dirDelta(sideDir)
    const key = cellKey(m.x + dx, m.y + dy)
    return readyOut(key, OPPOSITE[sideDir]) ? key : null
  }

  const combinerSlotForFeeder = (m: Machine, fromKey: string): 0 | 1 | -1 => {
    if (combinerFeeder(m, 0) === fromKey) return 0
    if (combinerFeeder(m, 1) === fromKey) return 1
    return -1
  }

  // A village's slot-`slot` feeder: the neighbour on that input side offering an
  // item inward. Mirrors combinerFeeder but over three sides.
  const villageFeeder = (m: Machine, slot: 0 | 1 | 2): string | null => {
    const sideDir = villageInputDirs(m.dir)[slot]
    const { dx, dy } = dirDelta(sideDir)
    const key = cellKey(m.x + dx, m.y + dy)
    return readyOut(key, OPPOSITE[sideDir]) ? key : null
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

  // Per-lane emission resolution for a crossover, memoized by `cell|exitSide`. A
  // lane's item leaves iff the cell it exits into accepts it; the in-progress set
  // breaks cycles (a downstream path that loops back through this same lane reads
  // "stays put" rather than recursing forever), exactly as `willEmit` does.
  const crossLeaveMemo = new Map<string, boolean>()
  const crossLeaveInProgress = new Set<string>()
  function crossoverWillLeave(key: string, outDir: Dir): boolean {
    const m = machines.get(key)
    if (!m || crossoverOut(key, outDir) === undefined) return false
    const memoKey = `${key}|${outDir}`
    const memo = crossLeaveMemo.get(memoKey)
    if (memo !== undefined) return memo
    if (crossLeaveInProgress.has(memoKey)) return false
    crossLeaveInProgress.add(memoKey)
    const { dx, dy } = dirDelta(outDir)
    const ok = accepts(cellKey(m.x + dx, m.y + dy), key)
    crossLeaveInProgress.delete(memoKey)
    crossLeaveMemo.set(memoKey, ok)
    return ok
  }

  // Memoized round-robin resolution for a splitter: the output side its held
  // item will leave through this tick, or null if it has no item or every
  // candidate side is blocked. Sides are tried from the cursor onward and the
  // first whose neighbour accepts wins. While a side is under test,
  // `chosenInProgress` holds it so that a downstream acceptance check which loops
  // back through this splitter (via winningFeeder → readyOut) sees the same
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
        const incoming = incomingValue(fromKey, tm)
        if (incoming === undefined || !villageSlotAccepts(slot, incoming)) return false
        return villageSlotFree(targetKey, slot)
      }
      case 'storage': {
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        const store = stores.get(targetKey)
        const incoming = incomingValue(fromKey, tm)
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
        const incoming = incomingValue(fromKey, tm)
        return incoming !== undefined && categoryOf(incoming) === 'villager'
      }
      case 'crossover': {
        // Feeder-inferred pass-through: an item entering from the source's side
        // exits the OPPOSITE side, riding the lane for that axis. Accept when that
        // lane is free (or its held item leaves this tick). If the opposite end is
        // ALSO offering into this lane, it's a head-on jam with no exit for either
        // — reject, so both feeders back up.
        const fm = machines.get(fromKey)
        if (!fm) return false
        const side = dirBetween(tm.x, tm.y, fm.x, fm.y) // side the source sits on
        if (side === null) return false
        const outDir = OPPOSITE[side]
        const cs = crossovers.get(targetKey)
        const held = laneFor(side) === 'v' ? cs?.v ?? null : cs?.h ?? null
        if (held && !(held.out === outDir && crossoverWillLeave(targetKey, outDir))) return false
        const { dx, dy } = dirDelta(outDir)
        if (readyOut(cellKey(tm.x + dx, tm.y + dy), side)) return false // opposite end feeds too
        return true
      }
      case 'teleporter': {
        // Only the send pad accepts adjacent input (the receive pad's items come
        // from the channel, never a neighbour). It banks like a seller — any item
        // from its winning feeder — but into the channel queue, and back-pressures
        // once that queue is full (or if the pad is unlinked / has no channel).
        if (teleporterRole(tm.catalogId) !== 'send') return false
        if (winningFeeder(tm.x, tm.y) !== fromKey) return false
        const ch = normalizeChannel(tm.channel)
        if (ch === null) return false
        if (incomingValue(fromKey, tm) === undefined) return false
        return (transit.get(ch)?.length ?? 0) < config.teleporterQueueCapacity
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
  const nextCrossovers = new Map<string, CrossoverState>()
  // Per-item live sales this tick (for the bounty board's `sell` objectives).
  const nextSold = new Map<string, number>()
  let money = state.money

  // The item (if any) that will actually arrive into single-input sink (tx,ty):
  // the highest-priority neighbour offering toward it whose item actually leaves.
  const arrivingItem = (tx: number, ty: number): string | undefined => {
    for (const nb of INCOMING) {
      const key = cellKey(tx + nb.dx, ty + nb.dy)
      if (!readyOut(key, nb.out)) continue
      return willLeaveOut(key, nb.out) ? valueOut(key, nb.out) : undefined
    }
    return undefined
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
        if (feeder && willLeaveOut(feeder, m.dir)) value = valueOut(feeder, m.dir) ?? value
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
      case 'crossover': {
        const cs = crossovers.get(key)
        let v = cs?.v ?? null
        let h = cs?.h ?? null
        // Emit: a lane whose held item leaves this tick clears.
        if (v && crossoverWillLeave(key, v.out)) v = null
        if (h && crossoverWillLeave(key, h.out)) h = null
        // Intake: pull a fresh item into a now-free lane from its single, non-
        // conflicting input side. Both ends of an axis offering = head-on jam =
        // no intake (they back up); neither offering = idle.
        const intake = (ends: [Dir, Dir]): CrossoverLane | null => {
          const offering = ends.filter((e) => {
            const d = dirDelta(e)
            return readyOut(cellKey(m.x + d.dx, m.y + d.dy), OPPOSITE[e])
          })
          if (offering.length !== 1) return null
          const inSide = offering[0]
          const outDir = OPPOSITE[inSide]
          const d = dirDelta(inSide)
          const nk = cellKey(m.x + d.dx, m.y + d.dy)
          if (!willLeaveOut(nk, outDir)) return null // source blocked this tick
          const item = valueOut(nk, outDir)
          return item !== undefined ? { item, out: outDir } : null
        }
        if (v === null) v = intake(['N', 'S'])
        if (h === null) h = intake(['E', 'W'])
        if (v || h) nextCrossovers.set(key, { v, h })
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
        if (feeder && willLeaveOut(feeder, m.dir)) in0 = valueOut(feeder, m.dir) ?? in0
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
          const inDir = OPPOSITE[inputDirs(m.dir)[slot]] // side the source emits toward
          if (feeder && willLeaveOut(feeder, inDir)) next[slot] = valueOut(feeder, inDir) ?? next[slot]
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
          const inDir = OPPOSITE[villageInputDirs(m.dir)[slot]] // side the source emits toward
          if (feeder && willLeaveOut(feeder, inDir)) next[slot] = valueOut(feeder, inDir) ?? next[slot]
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
            nextSold.set(incoming, (nextSold.get(incoming) ?? 0) + 1)
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
      // teleporter: no per-cell state — its transit queues are resolved below.
    }
  }

  // Resolve teleporter transit in one coordinated pass, since a channel's queue is
  // shared across pads (unlike every other machine, which owns its own state).
  // Start from a copy of each queue, remove the slots receive pads actually
  // emitted this tick, then append what send pads consumed (to the back, so the
  // 1-tick latency holds). Empty channels are dropped so the map doesn't grow.
  const nextTransit = new Map<string, string[]>()
  for (const [ch, q] of transit) nextTransit.set(ch, q.slice())

  // Dequeue: each receive pad claims one queue index (its rotated rank); if that
  // claimed item left its cell this tick (`willEmit`), remove that index. Multiple
  // outputs on a channel claim distinct indices, so removals never collide.
  for (const [ch, keys] of receiversByChannel) {
    const q = nextTransit.get(ch)
    if (!q || q.length === 0) continue
    const size = keys.length
    const consumed = new Set<number>()
    for (let i = 0; i < size; i++) {
      const rank = (i - (tick % size) + size) % size
      if (rank < q.length && willEmit(keys[i])) consumed.add(rank)
    }
    if (consumed.size > 0) nextTransit.set(ch, q.filter((_, idx) => !consumed.has(idx)))
  }

  // Enqueue: each send pad that received an item this tick appends it to its
  // channel. `accepts` already gated on capacity, so this only fires when there
  // was room. Appending after the dequeue keeps new arrivals invisible until next
  // tick.
  for (const m of machines.values()) {
    if (m.kind !== 'teleporter' || teleporterRole(m.catalogId) !== 'send') continue
    const ch = normalizeChannel(m.channel)
    if (!ch) continue
    const incoming = arrivingItem(m.x, m.y)
    if (incoming === undefined) continue
    const q = nextTransit.get(ch)
    if (q) q.push(incoming)
    else nextTransit.set(ch, [incoming])
  }

  for (const [ch, q] of nextTransit) if (q.length === 0) nextTransit.delete(ch)

  return {
    machines,
    items: nextItems,
    buffers: nextBuffers,
    stores: nextStores,
    townHalls: nextTownHalls,
    sellerBuffers: nextSellerBuffers,
    splitterCursors: nextSplitterCursors,
    crossovers: nextCrossovers,
    transit: nextTransit,
    money,
    sold: nextSold,
    prices,
    online,
    tick,
  }
}
