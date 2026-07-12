// Shared domain types for the factory world.

/** The four cardinal orientations a machine can face. */
export type Dir = 'N' | 'E' | 'S' | 'W'

/** The kinds of machine that can exist in the world. */
export type MachineKind = 'spawner' | 'belt' | 'processor' | 'combiner' | 'storage' | 'seller'

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

/** An item type definition (from data/items.json). */
export interface ItemDef {
  id: string
  name: string
  emoji: string
  /** Base/starting market value. */
  startingValue: number
  /** Market crash floor and ceiling (used from M7). */
  minPrice: number
  maxPrice: number
}

/** A buildable entry in the shop catalog (from data/catalog.json). */
export interface CatalogEntry {
  id: string
  kind: MachineKind
  name: string
  emoji: string
  /** Money cost to build (enforced from M6; placement is free in M2). */
  cost: number
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
