import type { CatalogEntry, Machine, MachineKind } from './types'
import { CATALOG, ITEMS, RECIPES, TUTORIALS } from '../data'
import { config } from '../data/config'
import { effectiveCost } from './economy'

// One-time tutorial cards, one per machine *kind*, shown as a strict sequence:
// the cards run in `data/tutorials.json` order, at most one is ever pending, and
// a card only comes due when the player can actually *run* that machine — not
// merely when its shop price is met. So the teaching tracks real progression:
// spawner and conveyor at the start (the free starter kit is already running),
// the processor / storage / seller as the first coins come in, the combiner once
// a second production line is within reach, and the village hut / town hall once
// villagers are.
//
// Two rules produce that sequence, and both matter:
//
//  1. **Order gate.** Only the first unseen card is ever a candidate, and it
//     waits until the PREVIOUS card's machine kind is standing in the world. The
//     player has to build the thing they were just taught before the next lesson
//     arrives, which is what keeps the cards spread across a session instead of
//     arriving in a burst the moment money allows. File order is the single
//     contract here — there is no separate "after" field to drift out of sync.
//
//  2. **Reachability gate**, named per card by its `gate` field and implemented
//     in `GATES` below. `machine` is the simple case (afford one, or already own
//     one). `combiner-recipe` and `villager-inputs` are the interesting ones:
//     they price the WHOLE chain — the missing spawners, the intermediate
//     processors/combiners, and the machine itself — so the combiner card lands
//     when a second spawner whose output pairs with processed ore is affordable,
//     and the hut card lands when a food, a drink and a bed are all reachable.
//
// The split mirrors achievements: content (title, emoji, tips, gate name) is
// declarative JSON — editable, emoji vendored by `scripts/vendor-twemoji.mjs`,
// checked by `validateData()` — while the gates are code, and
// `assertTutorialGatesWired()` fails the build if the two ever drift.

/** Declarative content for one tutorial card (from data/tutorials.json). */
export interface TutorialDef {
  id: string
  /** The machine kind this card teaches. One card per kind. */
  kind: MachineKind
  /** Which `GATES` predicate decides when this card is due. */
  gate: string
  /** Card heading (the emoji is rendered separately beside it). */
  title: string
  /** Display sprite (rasterized like any emoji; vendor its icon). */
  emoji: string
  /** The bullet points, in reading order. Keep them short and concrete. */
  tips: string[]
}

/** The live state a tutorial gate inspects. */
export interface TutorialContext {
  /** cell key `x,y` → placed machine (for placed kinds + per-copy cost growth). */
  world: Map<string, Machine>
  money: number
  /** The town-hall mason discount, so prices match what the shop charges. */
  buildCostMultiplier: number
}

// --- Content indexes (built once at load) ----------------------------------

const CATALOG_BY_KIND = new Map<MachineKind, CatalogEntry[]>()
for (const entry of CATALOG) {
  const list = CATALOG_BY_KIND.get(entry.kind)
  if (list) list.push(entry)
  else CATALOG_BY_KIND.set(entry.kind, [entry])
}

/** Spawner entries that emit a given item id (usually exactly one). */
const SPAWNERS_BY_ITEM = new Map<string, CatalogEntry[]>()
for (const entry of CATALOG) {
  if (entry.kind !== 'spawner' || !entry.outputItem) continue
  const list = SPAWNERS_BY_ITEM.get(entry.outputItem)
  if (list) list.push(entry)
  else SPAWNERS_BY_ITEM.set(entry.outputItem, [entry])
}

const PROCESSOR_IN_BY_OUT = new Map(RECIPES.processor.map((r) => [r.out, r.in]))
const COMBINER_INS_BY_OUT = new Map(RECIPES.combiner.map((r) => [r.out, [r.a, r.b] as const]))
const itemsInCategory = (category: string): string[] =>
  ITEMS.filter((i) => i.category === category).map((i) => i.id)

// --- The player's factory, as the gates see it ------------------------------

interface Factory {
  money: number
  placedKinds: Set<MachineKind>
  /** catalog id → copies placed (drives `costGrowth` on the next copy). */
  counts: Map<string, number>
  buildCostMultiplier: number
}

function snapshot(ctx: TutorialContext): Factory {
  const placedKinds = new Set<MachineKind>()
  const counts = new Map<string, number>()
  for (const m of ctx.world.values()) {
    placedKinds.add(m.kind)
    counts.set(m.catalogId, (counts.get(m.catalogId) ?? 0) + 1)
  }
  return { money: ctx.money, placedKinds, counts, buildCostMultiplier: ctx.buildCostMultiplier }
}

/** What the shop would charge for the next copy of an entry, discount included. */
function price(f: Factory, entry: CatalogEntry): number {
  return Math.round(effectiveCost(entry, f.counts.get(entry.id) ?? 0) * f.buildCostMultiplier)
}

/** The cheapest next copy of any machine of a kind, or null if the kind has none. */
function kindPrice(f: Factory, kind: MachineKind): number | null {
  const entries = CATALOG_BY_KIND.get(kind)
  if (!entries || entries.length === 0) return null
  return Math.min(...entries.map((entry) => price(f, entry)))
}

// --- Chain pricing ---------------------------------------------------------
// What would it cost to start producing an item from what the player already
// owns? Walk its recipe tree, accumulating one entry per machine into a shared
// map so a step two chains have in common is paid for once (the same dedupe
// trick `scaling.ts` uses for its production lines). A spawner the player
// already owns is free — that is the whole point: the second line is cheap
// precisely because ore is already flowing.
//
// Deliberately approximate in two ways, both of which only ever make a card
// arrive slightly LATER than strictly necessary: every processor/combiner step
// is priced even if an idle one is already built, and belts are ignored.

/** Accumulate machines needed for `item` into `acc`; false if it has no source. */
function collect(item: string, f: Factory, acc: Map<string, number>, seen: Set<string>): boolean {
  if (seen.has(item)) return true // already priced (or a cycle — recipes are acyclic)
  seen.add(item)

  const spawners = SPAWNERS_BY_ITEM.get(item)
  if (spawners) {
    // Owning any spawner for this item makes it free; otherwise buy the cheapest.
    const owned = spawners.find((entry) => (f.counts.get(entry.id) ?? 0) > 0)
    if (owned) return true
    const cheapest = spawners.reduce((best, e) => (price(f, e) < price(f, best) ? e : best))
    acc.set(`sp:${cheapest.id}`, price(f, cheapest))
    return true
  }

  // Villagers come out of a village hut fed by food + drink + bed.
  if (item === config.villageRecipe.output) {
    if (!f.placedKinds.has('village')) {
      const hut = kindPrice(f, 'village')
      if (hut === null) return false
      acc.set('village', hut)
    }
    return collectVillagerInputs(f, acc, seen)
  }

  const input = PROCESSOR_IN_BY_OUT.get(item)
  if (input !== undefined) {
    const proc = kindPrice(f, 'processor')
    if (proc === null) return false
    acc.set(`proc:${item}`, proc)
    return collect(input, f, acc, seen)
  }

  const pair = COMBINER_INS_BY_OUT.get(item)
  if (pair) {
    const comb = kindPrice(f, 'combiner')
    if (comb === null) return false
    acc.set(`comb:${item}`, comb)
    return collect(pair[0], f, acc, seen) && collect(pair[1], f, acc, seen)
  }

  return false // no spawner and no recipe: unreachable
}

/**
 * Price the village hut's three input slots into `acc`. The food and drink slots
 * accept a whole category, so each takes its cheapest reachable candidate —
 * chosen per slot, which can miss a costlier food that shares a spawner with the
 * bed chain, and so only ever over-estimates.
 */
function collectVillagerInputs(f: Factory, acc: Map<string, number>, seen: Set<string>): boolean {
  const r = config.villageRecipe
  const slots = [itemsInCategory(r.food), itemsInCategory(r.drink), [r.bed]]
  for (const candidates of slots) {
    let best: { item: string; cost: number } | null = null
    for (const candidate of candidates) {
      const cost = chainCost([candidate], f)
      if (cost !== null && (best === null || cost < best.cost)) best = { item: candidate, cost }
    }
    if (best === null) return false // this slot can't be filled at all
    if (!collect(best.item, f, acc, seen)) return false
  }
  return true
}

/** Total cost to start producing every listed item, or null if any is unreachable. */
function chainCost(items: string[], f: Factory): number | null {
  const acc = new Map<string, number>()
  const seen = new Set<string>()
  for (const item of items) {
    if (!collect(item, f, acc, seen)) return null
  }
  let total = 0
  for (const cost of acc.values()) total += cost
  return total
}

// --- Gates ----------------------------------------------------------------

type Gate = (f: Factory, def: TutorialDef) => boolean

/**
 * When each card comes due, keyed by the `gate` name in `tutorials.json`.
 * Every card names exactly one, and `assertTutorialGatesWired()` keeps the two
 * halves honest.
 */
const GATES: Record<string, Gate> = {
  /** Plumbing: the player owns one of these, or can buy one right now. */
  machine: (f, def) => {
    if (f.placedKinds.has(def.kind)) return true
    const cost = kindPrice(f, def.kind)
    return cost !== null && f.money >= cost
  },

  /**
   * The combiner earns its card once some pairing is actually within reach —
   * both inputs producible and the whole chain affordable. With ore already
   * flowing, the trigger in practice is affording the second spawner that pairs
   * with it (a stick from an oak tree, against a bar from ore).
   */
  'combiner-recipe': (f) =>
    RECIPES.combiner.some((r) => {
      const cost = chainCost([r.out], f)
      return cost !== null && f.money >= cost
    }),

  /** The hut earns its card once a food, a drink and a bed are all reachable. */
  'villager-inputs': (f) => {
    const cost = chainCost([config.villageRecipe.output], f)
    return cost !== null && f.money >= cost
  },
}

/** Content errors if a card names an unknown gate, or a gate has no card (build-time check). */
export function assertTutorialGatesWired(): string[] {
  const errors: string[] = []
  const used = new Set<string>()
  for (const t of TUTORIALS) {
    if (!(t.gate in GATES)) errors.push(`tutorial "${t.id}" names unknown gate "${t.gate}"`)
    used.add(t.gate)
  }
  for (const name of Object.keys(GATES)) {
    if (!used.has(name)) errors.push(`tutorial gate "${name}" is not used by any card`)
  }
  return errors
}

// --- The sequence ---------------------------------------------------------

/** A tutorial by id, or undefined if the id is unknown. */
export function tutorialById(id: string): TutorialDef | undefined {
  return TUTORIALS.find((t) => t.id === id)
}

/**
 * The single card due right now, or null. Never skips ahead: only the first
 * unseen card is considered, it waits for the previous card's machine to be
 * standing, and then for its own reachability gate. Pure — the caller decides
 * when to show it and when to bank its id as seen.
 *
 * Cheap: early-outs before touching the world once every card has been seen,
 * which is the steady state for most of a save's life.
 */
export function nextTutorial(ctx: TutorialContext, seen: ReadonlySet<string>): TutorialDef | null {
  const index = TUTORIALS.findIndex((t) => !seen.has(t.id))
  if (index < 0) return null
  const def = TUTORIALS[index]
  const f = snapshot(ctx)
  const previous = TUTORIALS[index - 1]
  // Learn it, build it, then get the next lesson.
  if (previous && !f.placedKinds.has(previous.kind)) return null
  return GATES[def.gate]?.(f, def) ? def : null
}

/** The tutorial ids for kinds already present in a factory — used by save migration. */
export function tutorialsForPlacedKinds(machines: Iterable<Machine>): string[] {
  const placed = new Set<MachineKind>()
  for (const m of machines) placed.add(m.kind)
  return TUTORIALS.filter((t) => placed.has(t.kind)).map((t) => t.id)
}
