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

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(
  CATALOG.map((entry) => [entry.id, entry]),
)
