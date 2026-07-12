import type { CatalogEntry, ItemDef, Recipes } from '../game/types'
import itemsRaw from './items.json'
import catalogRaw from './catalog.json'
import recipesRaw from './recipes.json'

// Typed views over the JSON data files. The `as` assertions narrow the JSON's
// widened `string` fields to our union types (Dir, MachineKind).
export const ITEMS = itemsRaw as ItemDef[]
export const CATALOG = catalogRaw as CatalogEntry[]
export const RECIPES = recipesRaw as Recipes

export const ITEMS_BY_ID: Record<string, ItemDef> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item]),
)

/**
 * Current sale price of an item. In M5 this is the static base table from
 * items.json (`startingValue`); M7 replaces it with the live market price. All
 * selling (auto-sellers, storage Sell-All) reads through here so that swap is
 * localized.
 */
export function basePrice(itemId: string): number {
  return ITEMS_BY_ID[itemId]?.startingValue ?? 0
}

/** Storage capacity for a catalog entry (falls back to 0 for non-storage). */
export function storageCapacity(catalogId: string): number {
  return CATALOG_BY_ID[catalogId]?.capacity ?? 0
}

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(
  CATALOG.map((entry) => [entry.id, entry]),
)

// --- Recipe lookups (M4) ---------------------------------------------------
// Processors are 1→1; combiners take an order-independent pair. We index both
// so the tick engine can resolve a transform in O(1). Combiner pairs are keyed
// canonically (sorted) so {a,b} and {b,a} hit the same entry.

const PROCESSOR_OUT_BY_IN: Record<string, string> = Object.fromEntries(
  RECIPES.processor.map((r) => [r.in, r.out]),
)

const combinerKey = (a: string, b: string): string => (a <= b ? `${a}+${b}` : `${b}+${a}`)

const COMBINER_OUT_BY_PAIR: Record<string, string> = Object.fromEntries(
  RECIPES.combiner.map((r) => [combinerKey(r.a, r.b), r.out]),
)

/** The processor output for an input item, or null if no recipe matches. */
export function processorOutput(input: string): string | null {
  return PROCESSOR_OUT_BY_IN[input] ?? null
}

/** The combiner output for an unordered pair of inputs, or null if none matches. */
export function combinerOutput(a: string, b: string): string | null {
  return COMBINER_OUT_BY_PAIR[combinerKey(a, b)] ?? null
}
