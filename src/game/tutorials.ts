import type { Machine, MachineKind } from './types'
import { CATALOG, TUTORIALS } from '../data'
import { effectiveCost } from './economy'

// One-time tutorial cards, one per machine *kind*: a short "what this thing does"
// popup that fires the first time the player could actually build one, and then
// never again. Teaching is triggered by affordability rather than by a scripted
// step order, so the game never blocks or nags — the card just meets the player
// at the moment the shop button lights up.
//
// The split mirrors achievements: the CONTENT (title, emoji, tips) is declarative
// and lives in `data/tutorials.json` — so it's editable, gets its emoji vendored
// by `scripts/vendor-twemoji.mjs`, and is checked by `validateData()` — while the
// TRIGGER is the logic below.
//
// A tutorial is keyed by `MachineKind`, not by catalog id: the player needs the
// concept of a spawner once, not one card per spawner variant. `validateData()`
// enforces one tutorial per kind and rejects a kind no catalog entry provides.

/** Declarative content for one tutorial card (from data/tutorials.json). */
export interface TutorialDef {
  id: string
  /** The machine kind this card teaches; also what gates the trigger. */
  kind: MachineKind
  /** Card heading (the emoji is rendered separately beside it). */
  title: string
  /** Display sprite (rasterized like any emoji; vendor its icon). */
  emoji: string
  /** The bullet points, in reading order. Keep them short and concrete. */
  tips: string[]
}

/** Catalog entries grouped by machine kind, so a trigger check is a small loop. */
const CATALOG_BY_KIND = new Map<MachineKind, typeof CATALOG>()
for (const entry of CATALOG) {
  const list = CATALOG_BY_KIND.get(entry.kind)
  if (list) list.push(entry)
  else CATALOG_BY_KIND.set(entry.kind, [entry])
}

/** The live state a tutorial trigger inspects. */
export interface TutorialContext {
  /** cell key `x,y` → placed machine (for the placed-kind check + copy counts). */
  world: Map<string, Machine>
  money: number
  /** The town-hall mason discount, so the threshold matches what the shop charges. */
  buildCostMultiplier: number
}

/** A tutorial by id, or undefined if the id is unknown. */
export function tutorialById(id: string): TutorialDef | undefined {
  return TUTORIALS.find((t) => t.id === id)
}

/**
 * The tutorials that should pop right now: every card not already in `seen`
 * whose machine kind is either **already placed** (so the concept is in play —
 * this is what explains the free starter kit on a brand-new game) or
 * **affordable**, meaning the player has the money for at least one catalog
 * entry of that kind at its current, discount-adjusted price.
 *
 * Returned in `tutorials.json` order, so a burst (the starter kit, or a windfall
 * that unlocks several at once) plays out as a stable sequence. Pure — the caller
 * decides when to queue and when to bank an id as seen.
 *
 * Cheap by design: it early-outs before touching the world once every card has
 * been seen, which is the steady state after the first few minutes of a save.
 */
export function newlyTriggered(ctx: TutorialContext, seen: ReadonlySet<string>): TutorialDef[] {
  const pending = TUTORIALS.filter((t) => !seen.has(t.id))
  if (pending.length === 0) return []

  // One pass over the world serves both checks: which kinds exist, and how many
  // copies of each catalog id are placed (its cost grows per copy).
  const placedKinds = new Set<MachineKind>()
  const placedCounts = new Map<string, number>()
  for (const m of ctx.world.values()) {
    placedKinds.add(m.kind)
    placedCounts.set(m.catalogId, (placedCounts.get(m.catalogId) ?? 0) + 1)
  }

  const affordable = (kind: MachineKind): boolean => {
    for (const entry of CATALOG_BY_KIND.get(kind) ?? []) {
      const base = effectiveCost(entry, placedCounts.get(entry.id) ?? 0)
      if (ctx.money >= Math.round(base * ctx.buildCostMultiplier)) return true
    }
    return false
  }

  return pending.filter((t) => placedKinds.has(t.kind) || affordable(t.kind))
}

/** The tutorial ids for kinds already present in a factory — used by save migration. */
export function tutorialsForPlacedKinds(machines: Iterable<Machine>): string[] {
  const placed = new Set<MachineKind>()
  for (const m of machines) placed.add(m.kind)
  return TUTORIALS.filter((t) => placed.has(t.kind)).map((t) => t.id)
}
