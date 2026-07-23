import { BOUNTY_TEMPLATES, CATALOG, ITEMS, ITEMS_BY_ID, RECIPES } from './index'
import { ITEM_CATEGORIES } from '../game/types'
import { config } from './config'

// Referential-integrity check over the content JSON (items / catalog / recipes).
// Nothing links these files at compile time, so a mistyped item id used to fail
// silently — a bad recipe input just produced junk, a bad output produced an
// item that never rendered. `validateData()` catches those at build time (wired
// into vite.config.ts) and in the test suite (test/data.test.ts), so a typo is
// a loud failure instead of a quiet gameplay bug.

/** Returns a list of human-readable content errors; empty means the data is sound. */
export function validateData(): string[] {
  const errors: string[] = []
  const itemIds = new Set(ITEMS.map((i) => i.id))

  const known = (id: string): boolean => itemIds.has(id)

  // Duplicate ids would make the *_BY_ID lookups silently shadow an entry.
  const dupes = (ids: string[], label: string) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${label} id: "${id}"`)
      seen.add(id)
    }
  }
  dupes(ITEMS.map((i) => i.id), 'item')
  dupes(CATALOG.map((c) => c.id), 'catalog')
  dupes(BOUNTY_TEMPLATES.map((b) => b.id), 'bounty')

  // Every item must carry a known category (used to group the market/shop UI).
  const categories = new Set<string>(ITEM_CATEGORIES)
  for (const item of ITEMS) {
    if (!categories.has(item.category)) {
      errors.push(`item "${item.id}" has unknown category "${item.category}"`)
    }
  }

  // The junk fallback item must exist; the tick engine emits it for any
  // un-matched processor/combiner transform.
  if (!known(config.junkItemId)) {
    errors.push(`config.junkItemId "${config.junkItemId}" is not a defined item`)
  }

  // The Village Hut recipe must be satisfiable: its output and bed item must
  // exist, and at least one food and one drink item must exist to feed it.
  const vr = config.villageRecipe
  if (!known(vr.output)) errors.push(`villageRecipe output "${vr.output}" is not a defined item`)
  if (!known(vr.bed)) errors.push(`villageRecipe bed "${vr.bed}" is not a defined item`)
  for (const cat of [vr.food, vr.drink]) {
    if (!ITEMS.some((i) => i.category === cat)) {
      errors.push(`villageRecipe needs at least one "${cat}" item to exist`)
    }
  }

  for (const entry of CATALOG) {
    if (entry.kind === 'spawner') {
      if (!entry.outputItem) {
        errors.push(`spawner "${entry.id}" has no outputItem`)
      } else if (!known(entry.outputItem)) {
        errors.push(`spawner "${entry.id}" outputItem "${entry.outputItem}" is not a defined item`)
      }
      if (!entry.rateTicks || entry.rateTicks <= 0) {
        errors.push(`spawner "${entry.id}" needs a positive rateTicks`)
      }
    } else if (entry.outputItem) {
      // outputItem only means something for spawners; flag it elsewhere so a
      // misplaced field doesn't look wired up when it isn't.
      errors.push(`catalog "${entry.id}" (kind ${entry.kind}) sets outputItem but is not a spawner`)
    }
    if (entry.kind === 'storage' && (!entry.capacity || entry.capacity <= 0)) {
      errors.push(`storage "${entry.id}" needs a positive capacity`)
    }
    if (entry.kind === 'teleporter' && entry.role !== 'send' && entry.role !== 'receive') {
      errors.push(`teleporter "${entry.id}" needs role "send" or "receive" (got ${entry.role})`)
    }
    if (entry.costGrowth !== undefined && entry.costGrowth < 1) {
      errors.push(`catalog "${entry.id}" costGrowth must be >= 1 (got ${entry.costGrowth})`)
    }
  }

  for (const r of RECIPES.processor) {
    if (!known(r.in)) errors.push(`processor recipe input "${r.in}" is not a defined item`)
    if (!known(r.out)) errors.push(`processor recipe output "${r.out}" is not a defined item`)
  }
  for (const r of RECIPES.combiner) {
    if (!known(r.a)) errors.push(`combiner recipe input "${r.a}" is not a defined item`)
    if (!known(r.b)) errors.push(`combiner recipe input "${r.b}" is not a defined item`)
    if (!known(r.out)) errors.push(`combiner recipe output "${r.out}" is not a defined item`)
  }

  // Bounty templates: the board draws live bounties from these, so a broken
  // catalog/item reference would produce an un-completable bounty. Catch it here.
  const catalogIds = new Set(CATALOG.map((c) => c.id))
  const objectives = new Set(['earn', 'sell', 'place', 'bank'])
  for (const b of BOUNTY_TEMPLATES) {
    if (!objectives.has(b.objective)) {
      errors.push(`bounty "${b.id}" has unknown objective "${b.objective}"`)
    }
    if (!b.title) errors.push(`bounty "${b.id}" has no title`)
    if (!b.emoji) errors.push(`bounty "${b.id}" has no emoji`)
    const [min, max] = b.targetRange ?? []
    if (!(typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min)) {
      errors.push(`bounty "${b.id}" needs a targetRange [min, max] with 0 < min <= max`)
    }
    if (!(b.durationMinutes > 0)) errors.push(`bounty "${b.id}" needs a positive durationMinutes`)
    if (!(b.rewardPerUnit >= 0)) errors.push(`bounty "${b.id}" needs a non-negative rewardPerUnit`)
    if (b.objective === 'place') {
      if (!b.catalogId || !catalogIds.has(b.catalogId)) {
        errors.push(`bounty "${b.id}" (place) catalogId "${b.catalogId}" is not a defined catalog entry`)
      }
    }
    if (b.objective === 'sell') {
      if (!b.itemId || !known(b.itemId)) {
        errors.push(`bounty "${b.id}" (sell) itemId "${b.itemId}" is not a defined item`)
      }
    }
    if (b.objective === 'bank' && b.itemId !== undefined) {
      if (!known(b.itemId)) {
        errors.push(`bounty "${b.id}" (bank) itemId "${b.itemId}" is not a defined item`)
      } else if (ITEMS_BY_ID[b.itemId].category !== 'villager') {
        errors.push(`bounty "${b.id}" (bank) itemId "${b.itemId}" must be a villager item`)
      }
    }
  }

  // Cross-check the lookup index was built over the same item set (guards against
  // an ITEMS_BY_ID that drifts from ITEMS).
  if (Object.keys(ITEMS_BY_ID).length !== itemIds.size) {
    errors.push('ITEMS_BY_ID entry count does not match ITEMS (duplicate ids?)')
  }

  return errors
}

/** Throws with a combined message if the content data has any errors. */
export function assertDataValid(): void {
  const errors = validateData()
  if (errors.length > 0) {
    throw new Error(`Invalid game data:\n  - ${errors.join('\n  - ')}`)
  }
}
