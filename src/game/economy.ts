import type { CatalogEntry, Machine } from './types'

// Buy-cost rules (M6). Placement is buying: the player pays a machine's cost
// from their money. Basics (ore gatherer, conveyor, storage) are free for the
// FIRST copy while none of that exact catalog id is placed — a safety net that
// lets a broke player always rebuild an earning setup, while additional copies
// cost full price so the free tier can't be abused.

/** How many machines of a given catalog id are currently placed in the world. */
export function countPlaced(world: Map<string, Machine>, catalogId: string): number {
  let n = 0
  for (const m of world.values()) if (m.catalogId === catalogId) n++
  return n
}

/**
 * The money a player must pay to place this entry, given how many of it are
 * already placed. Free when `freeIfNonePlaced` and none are placed yet;
 * otherwise the catalog price.
 */
export function effectiveCost(entry: CatalogEntry, placedCount: number): number {
  if (entry.freeIfNonePlaced && placedCount === 0) return 0
  return entry.cost
}
