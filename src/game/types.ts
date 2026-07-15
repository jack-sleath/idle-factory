// Shared domain types for the factory world.

/** The four cardinal orientations a machine can face. */
export type Dir = 'N' | 'E' | 'S' | 'W'

/** The kinds of machine that can exist in the world. */
export type MachineKind =
  | 'spawner'
  | 'belt'
  | 'processor'
  | 'combiner'
  | 'storage'
  | 'seller'
  | 'splitter'
  | 'village'
  | 'townhall'

/**
 * A placed machine. Keyed in the world by its cell (`x,y`). `dir` is the
 * orientation: for belts/spawners/processors it is the output side; combiners
 * treat it as the output side (inputs are the two perpendicular sides).
 * Runtime-only fields (buffers, storage counts) are added in later milestones.
 */
export interface Machine {
  id: string
  kind: MachineKind
  /** Catalog entry this machine was built from (identifies spawner variants). */
  catalogId: string
  x: number
  y: number
  dir: Dir
}

/**
 * Item categories, for grouping in the market/shop UI. Rule of thumb:
 * `material` is anything whose only value is as an in-between production step
 * (ores, metal bars, wood, textile, wheat/sugarcane/sugar, dough, pie cases);
 * raw things that are food/treasure in their own right keep that identity
 * (an apple is `food`, a diamond is `valuable`). `misc` is the catch-all for
 * finished goods that fit nothing else (furniture, junk). The canonical list
 * lives here so the `ItemCategory` union and `validateData()` stay in sync.
 */
export const ITEM_CATEGORIES = ['food', 'drink', 'valuable', 'weapon', 'material', 'villager', 'misc'] as const
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]

/** An item type definition (from data/items.json). */
export interface ItemDef {
  id: string
  name: string
  emoji: string
  /** Grouping bucket for the market/shop UI (see `ITEM_CATEGORIES`). */
  category: ItemCategory
  /**
   * Base/starting market value. Also the crash reset target, and the anchor the
   * market's crash band is derived from (`config.crashFloor/CeilingMultiple`).
   */
  startingValue: number
}

/** A buildable entry in the shop catalog (from data/catalog.json). */
export interface CatalogEntry {
  id: string
  kind: MachineKind
  name: string
  emoji: string
  /** Money cost to build the FIRST paid copy (enforced from M6). */
  cost: number
  /**
   * Per-copy cost growth. Each additional placed copy of this catalog id costs
   * `cost × costGrowth ^ placedCount`, so the Nth copy is pricier than the
   * first — the standard idle-game curve that stops one cheap line from being
   * spammed into infinite income. Omitted / 1 = flat cost (every copy the same).
   */
  costGrowth?: number
  /** If true, the first copy (while none placed) is free (M6). */
  freeIfNonePlaced?: boolean
  /** Default facing when placed. */
  defaultDir?: Dir
  /** Spawner only: the item id it emits. */
  outputItem?: string
  /** Spawner only: ticks between emissions. */
  rateTicks?: number
  /** Storage only: maximum units it can hold (M5). */
  capacity?: number
}

/** Processor recipe: one input item transforms into one output item. */
export interface ProcessorRecipe {
  in: string
  out: string
}

/** Combiner recipe: an order-independent pair of inputs yields one output. */
export interface CombinerRecipe {
  a: string
  b: string
  out: string
}

export interface Recipes {
  processor: ProcessorRecipe[]
  combiner: CombinerRecipe[]
}
