import type { Machine } from './types'
import type { StorageState, TownHallState } from './tick'
import { ACHIEVEMENT_META, CATALOG_BY_ID, ITEMS, storageCapacity } from '../data'

// Achievements: permanent, one-time recognitions unlocked by hitting a SPECIFIC,
// hand-authored condition — not a grind threshold. Where the daily bounty board
// (`bounties.ts`) rewards ordinary play ("earn 100k", "sell 500 bread"), an
// achievement rewards doing something particular and often playful: assembling a
// full set, arranging the factory a certain way, or an easter-egg combination.
// So each one is a PREDICATE over live game state, evaluated cheaply and often,
// rather than a counter.
//
// The two halves are split to match the rest of the codebase:
//   - METADATA (name, blurb, emoji, external-service id map) is declarative and
//     lives in `data/achievements.json` — so it's editable content, gets its
//     emoji vendored by `scripts/vendor-twemoji.mjs`, and is checked by
//     `validateData()`.
//   - The CONDITION is bespoke logic, so it lives here in `CHECKS`, keyed by id.
// `ACHIEVEMENTS` joins the two; `assertAchievementsWired()` (run by validation)
// guarantees every metadata id has exactly one predicate and vice-versa.
//
// By design an achievement carries NO in-game reward (no coins, no multipliers):
// it is pure status, so it can't distort the tuned income/cost economy and it
// maps cleanly onto external achievement systems (Steam, consoles), which are
// themselves status-only. See `achievementProviders.ts` for that plug point.
//
// State a predicate can read is bundled in `AchievementContext`. Most is the
// persisted live world; `sellerSales` is a light in-memory accumulation (which
// item types have passed through each seller this session) that unlocks a whole
// class of "sold X and Y at one stand" achievements without new saved state.
// Progress is only observed during active play — offline catch-up clears the
// transient maps and never fabricates a seller sale — so achievements are a
// hands-on feature, like the bounty board.

/** Declarative metadata for one achievement (from data/achievements.json). */
export interface AchievementMeta {
  id: string
  name: string
  /** One-line description of the feat (also the hint before it's unlocked). */
  description: string
  /** Display sprite (rasterized like any emoji; vendor its icon). */
  emoji: string
  /**
   * Per-provider external identifiers, keyed by provider id (e.g.
   * `{ steam: "ACH_POCKET_MONSTERS" }`). One place owns the whole mapping, so an
   * external adapter (`achievementProviders.ts`) can translate an unlock into
   * that platform's call with no change here.
   */
  external?: Record<string, string>
}

/** The live game state an achievement predicate inspects. */
export interface AchievementContext {
  /** cell key `x,y` → placed machine (kind, catalogId, dir, channel). */
  world: Map<string, Machine>
  /** cell key → banked villagers `{villagerId: count}`, for town hall cells. */
  townHalls: Map<string, TownHallState>
  /** cell key → `{item, count}`, for storage cells. */
  stores: Map<string, StorageState>
  /** Bank balance. */
  money: number
  /**
   * cell key of a seller → the set of item ids it has sold this session. In
   * memory only (not persisted): rebuilt from the tick stream, which is plenty —
   * a running production line re-populates it within seconds of a load, and the
   * unlock itself, once earned, is what's persisted.
   */
  sellerSales: Map<string, Set<string>>
}

/** A predicate over live state; `true` → the achievement is unlocked. */
export type AchievementCheck = (ctx: AchievementContext) => boolean

/** An achievement: declarative metadata joined with its live-state predicate. */
export interface AchievementDef extends AchievementMeta {
  /** Must be pure and cheap; it runs on every relevant change. */
  check: AchievementCheck
}

// --- Shared derivations ----------------------------------------------------

/** Every villager item id (the full collectible set: base villager + specialists). */
const VILLAGER_IDS = ITEMS.filter((i) => i.category === 'villager').map((i) => i.id)
/** The specialist villagers only (excludes the generic base villager). */
const SPECIALIST_IDS = VILLAGER_IDS.filter((id) => id !== 'villager')

/** True if some single town hall has banked at least one of every id in `ids`. */
function someHallHasAll(ctx: AchievementContext, ids: string[]): boolean {
  for (const counts of ctx.townHalls.values()) {
    if (ids.every((id) => (counts[id] ?? 0) > 0)) return true
  }
  return false
}

/** The set of villager ids banked anywhere across all town halls. */
function bankedAnywhere(ctx: AchievementContext): Set<string> {
  const seen = new Set<string>()
  for (const counts of ctx.townHalls.values()) {
    for (const [id, n] of Object.entries(counts)) if (n > 0) seen.add(id)
  }
  return seen
}

/** True if any single seller has sold every item id in `items`. */
function someSellerSold(ctx: AchievementContext, items: string[]): boolean {
  for (const sold of ctx.sellerSales.values()) {
    if (items.every((id) => sold.has(id))) return true
  }
  return false
}

/** True if a storage cell is filled to its capacity with `item`. */
function someStorageFullOf(ctx: AchievementContext, item: string): boolean {
  for (const [key, store] of ctx.stores) {
    if (store.item !== item || store.count <= 0) continue
    const machine = ctx.world.get(key)
    const cap = machine ? storageCapacity(machine.catalogId) : 0
    if (cap > 0 && store.count >= cap) return true
  }
  return false
}

/** True if a send pad and a receive pad share the same non-empty channel. */
function hasLinkedTeleporters(ctx: AchievementContext): boolean {
  const sendChannels = new Set<string>()
  const receiveChannels = new Set<string>()
  for (const m of ctx.world.values()) {
    if (m.kind !== 'teleporter' || !m.channel) continue
    const role = CATALOG_BY_ID[m.catalogId]?.role
    if (role === 'send') sendChannels.add(m.channel)
    else if (role === 'receive') receiveChannels.add(m.channel)
  }
  for (const ch of sendChannels) if (receiveChannels.has(ch)) return true
  return false
}

// --- Conditions ------------------------------------------------------------
// Specific, playful feats — not milestones. A new achievement adds its metadata
// to data/achievements.json and its predicate here under the same id. Keep them
// in this spirit: a particular arrangement or combination, checkable from the
// context above.

export const CHECKS: Record<string, AchievementCheck> = {
  'pocket-monsters': (ctx) => someHallHasAll(ctx, VILLAGER_IDS),
  'full-employment': (ctx) => {
    const banked = bankedAnywhere(ctx)
    return SPECIALIST_IDS.every((id) => banked.has(id))
  },
  'duck-customer': (ctx) => someSellerSold(ctx, ['grapes', 'lemonade']),
  'breakfast-club': (ctx) => someSellerSold(ctx, ['pancakes', 'omelette']),
  'sweet-and-savoury': (ctx) => someSellerSold(ctx, ['pizza', 'ice-cream']),
  'cornucopia': (ctx) => {
    for (const sold of ctx.sellerSales.values()) if (sold.size >= 8) return true
    return false
  },
  'diamond-hands': (ctx) => someStorageFullOf(ctx, 'diamond'),
  'wormhole': (ctx) => hasLinkedTeleporters(ctx),
}

/** The full achievement set: metadata joined with its predicate. */
export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_META.map((meta) => ({
  ...meta,
  check:
    CHECKS[meta.id] ??
    (() => false), // an un-wired id never unlocks; assertAchievementsWired() flags it loudly
}))

const ACHIEVEMENTS_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
)

/** Look up an achievement definition by id (undefined if unknown). */
export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS_BY_ID[id]
}

/**
 * Referential check that metadata and predicates line up: every metadata id has
 * exactly one predicate, and no predicate is orphaned. Called by `validateData()`
 * so a missing/extra `CHECKS` entry fails the build instead of silently making an
 * achievement that can never unlock (or one with no way to show it).
 */
export function assertAchievementsWired(): string[] {
  const errors: string[] = []
  const metaIds = new Set(ACHIEVEMENT_META.map((m) => m.id))
  for (const id of metaIds) {
    if (!CHECKS[id]) errors.push(`achievement "${id}" has metadata but no CHECKS predicate`)
  }
  for (const id of Object.keys(CHECKS)) {
    if (!metaIds.has(id)) errors.push(`CHECKS has predicate "${id}" with no matching metadata entry`)
  }
  return errors
}

/**
 * Return the definitions of every achievement whose condition is now met but
 * that is NOT already in `unlocked`. Safe to call on every relevant change — it
 * never re-returns an unlocked one, so each fires exactly once. Order follows the
 * roster, giving a stable surfacing order for a burst of simultaneous unlocks.
 */
export function newlyUnlocked(ctx: AchievementContext, unlocked: ReadonlySet<string>): AchievementDef[] {
  const out: AchievementDef[] = []
  for (const def of ACHIEVEMENTS) {
    if (unlocked.has(def.id)) continue
    let met = false
    try {
      met = def.check(ctx)
    } catch {
      met = false // a broken predicate must never crash the tick loop
    }
    if (met) out.push(def)
  }
  return out
}
