// Recipe-book graph helpers. Pure, data-driven views over the item/catalog/
// recipe JSON so the UI (and tests) can answer two questions:
//   1. "What does each machine do?" — the browse lists below.
//   2. "How is item X made, all the way down?" — `sourcesFor`, walked
//      recursively by the tree view. Where a slot accepts a whole category
//      (a village hut's food/drink), every candidate is returned so the UI can
//      flick through them.
// Nothing here touches engine state; it only reads the static content tables.

import { CATALOG, CATALOG_BY_ID, RECIPES, ITEMS } from '../data'
import { config } from '../data/config'
import type { CatalogEntry, MachineKind } from './types'

/**
 * One input slot of a recipe. `candidates` are the item ids that can satisfy
 * it: length 1 for a fixed ingredient, or many for a category slot (all foods,
 * all drinks) the player flicks through. `slotLabel` names category slots.
 */
export interface Requirement {
  candidates: string[]
  slotLabel?: string
}

/**
 * A way to produce an item. Either a spawner (a leaf — raw resource emitted by
 * a machine with no item inputs) or a machine recipe with one or more input
 * requirements.
 */
export type RecipeSource =
  | { kind: 'spawner'; catalogId: string }
  | { kind: 'recipe'; machine: 'processor' | 'combiner' | 'village'; requirements: Requirement[] }

/** The catalog entry a machine kind maps to (first of that kind), if any. */
function machineOfKind(kind: MachineKind): CatalogEntry | undefined {
  return CATALOG.find((c) => c.kind === kind)
}

/** Display name + emoji for the machine that runs a recipe source. */
export function machineMeta(source: RecipeSource): { name: string; emoji: string } {
  if (source.kind === 'spawner') {
    const c = CATALOG_BY_ID[source.catalogId]
    return { name: c?.name ?? source.catalogId, emoji: c?.emoji ?? '⛏️' }
  }
  const kindEntry = machineOfKind(source.machine)
  const fallback: Record<string, { name: string; emoji: string }> = {
    processor: { name: 'Processor', emoji: '⚙️' },
    combiner: { name: 'Combiner', emoji: '🔀' },
    village: { name: 'Village Hut', emoji: '🏘️' },
  }
  return kindEntry
    ? { name: kindEntry.name, emoji: kindEntry.emoji }
    : fallback[source.machine]
}

/** Item ids in the given category, in items.json order. */
function itemsInCategory(category: string): string[] {
  return ITEMS.filter((i) => i.category === category).map((i) => i.id)
}

/**
 * Every way to produce `itemId`, most-direct first (spawner, then village, then
 * processor, then combiner). Empty means the item has no known source. In the
 * current content each item has exactly one source, but the list keeps the door
 * open for alternates (the tree view flicks through them too).
 */
export function sourcesFor(itemId: string): RecipeSource[] {
  const sources: RecipeSource[] = []

  for (const c of CATALOG) {
    if (c.kind === 'spawner' && c.outputItem === itemId) {
      sources.push({ kind: 'spawner', catalogId: c.id })
    }
  }

  // Village hut: food (any) + drink (any) + bed → villager.
  if (itemId === config.villageRecipe.output) {
    sources.push({
      kind: 'recipe',
      machine: 'village',
      requirements: [
        { candidates: itemsInCategory(config.villageRecipe.food), slotLabel: 'Food' },
        { candidates: itemsInCategory(config.villageRecipe.drink), slotLabel: 'Drink' },
        { candidates: [config.villageRecipe.bed], slotLabel: 'Bed' },
      ],
    })
  }

  for (const r of RECIPES.processor) {
    if (r.out === itemId) {
      sources.push({ kind: 'recipe', machine: 'processor', requirements: [{ candidates: [r.in] }] })
    }
  }

  for (const r of RECIPES.combiner) {
    if (r.out === itemId) {
      sources.push({
        kind: 'recipe',
        machine: 'combiner',
        requirements: [{ candidates: [r.a] }, { candidates: [r.b] }],
      })
    }
  }

  return sources
}

/** A spawner row for the browse view: which machine emits which item. */
export interface SpawnerRow {
  catalogId: string
  outputItem: string
}

/** All spawners, in catalog order. */
export function spawnerRows(): SpawnerRow[] {
  return CATALOG.filter(
    (c): c is CatalogEntry & { outputItem: string } => c.kind === 'spawner' && !!c.outputItem,
  ).map((c) => ({ catalogId: c.id, outputItem: c.outputItem }))
}

/** The village recipe as browse-view slots (food/drink categories + bed). */
export function villageBrowseRequirements(): Requirement[] {
  return [
    { candidates: itemsInCategory(config.villageRecipe.food), slotLabel: 'Food' },
    { candidates: itemsInCategory(config.villageRecipe.drink), slotLabel: 'Drink' },
    { candidates: [config.villageRecipe.bed], slotLabel: 'Bed' },
  ]
}

/** The villager item id the village hut produces. */
export const VILLAGE_OUTPUT = config.villageRecipe.output
