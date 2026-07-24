import type { Rng } from './market'
import { BOUNTY_TEMPLATES } from '../data'
import { config } from '../data/config'

// Daily challenges (a small set of harder objectives that refresh once a day and
// each pay a one-time coin reward). The board holds `config.bounties.boardSize`
// challenges drawn for the current calendar day; every challenge shares the same
// deadline — the next local midnight — so the whole set expires and is redrawn
// together at the day boundary.
//
// Design (see the achievements/bounty discussion): the reward is always a flat,
// one-time coin payout sized as a *garnish* on factory income — never a
// permanent multiplier (those stay the town hall's job) — so a recurring board
// can't distort the income/cost race the economy is tuned around. The daily
// cadence keeps that garnish small: at most `boardSize` payouts land per day.
//
// The reset burns in real (wall-clock) time whether the player is online or not,
// but PROGRESS only accrues during active play: callers advance `progress` on
// the relevant gameplay events (coins earned, machines placed, villagers banked)
// and offline catch-up never credits it. So the board is a hands-on feature —
// leaving the tab closed lets the day roll over but never completes a challenge.
// A completed challenge stays on the board (banked, marked done) until the daily
// reset — finishing one does NOT pull in a replacement mid-day.

/** What a challenge measures. */
export type BountyObjective =
  | 'earn' // total coins banked from sales (auto-sellers + Sell-All)
  | 'sell' // units of a given item sold (auto-sellers + Sell-All)
  | 'place' // machines built of a given catalog id
  | 'bank' // villagers banked into town halls (a specific type, or any)

/** A challenge definition (from data/bounties.json); the board draws instances from these. */
export interface BountyTemplate {
  id: string
  objective: BountyObjective
  /** Display label + sprite for the board row. */
  title: string
  emoji: string
  /** Inclusive [min, max] the rolled target is drawn from. */
  targetRange: [number, number]
  /** reward = round(target × rewardPerUnit). For `earn` this is a small fraction. */
  rewardPerUnit: number
  /** `place` only: the catalog id whose placements count. */
  catalogId?: string
  /**
   * The item id this challenge is about: for `sell`, the item to sell; for `bank`,
   * a specific villager (or omitted to count ANY villager). Unused by `earn`/`place`.
   */
  itemId?: string
}

/** A live daily challenge on the board (persisted in the save). */
export interface ActiveBounty {
  /** Unique instance id (distinguishes two draws of the same template). */
  id: string
  templateId: string
  objective: BountyObjective
  title: string
  emoji: string
  target: number
  /** Progress so far (0..target); only advances during active play. */
  progress: number
  reward: number
  /** Wall-clock ms of the day boundary this challenge expires at (next midnight). */
  deadline: number
  /** Local-midnight ms of the day this challenge belongs to (the board's "day"). */
  day: number
  /** Wall-clock ms it was completed + its reward banked; unset while unfinished. */
  completedAt?: number
  catalogId?: string
  itemId?: string
}

/** A finished challenge, kept for the completed list (most-recent first). */
export interface CompletedBounty {
  title: string
  emoji: string
  reward: number
  /** Wall-clock ms timestamp it was banked. */
  at: number
}

/** Result of settling the board: the (possibly refreshed) board plus payouts to apply. */
export interface BountySettlement {
  board: ActiveBounty[]
  completed: CompletedBounty[]
  reward: number
  /** True if the board reference changed (a challenge banked, or the day rolled over). */
  changed: boolean
}

// Monotonic per-session counter so two challenges drawn in the same millisecond
// still get distinct ids (ids only need to be unique within a session).
let drawSeq = 0

/** Local-midnight (ms) of the day containing `now` — the board's day marker. */
export function dayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local-midnight (ms) of the NEXT day — the deadline for `now`'s challenges. */
export function nextDayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** Round a rolled target to a tidy value: earn to the nearest 1000, counts to whole units. */
function quantizeTarget(objective: BountyObjective, raw: number): number {
  if (objective === 'earn') return Math.max(1000, Math.round(raw / 1000) * 1000)
  return Math.max(1, Math.round(raw))
}

/** Draw a concrete challenge instance from a template for the day containing `now`. */
export function drawBounty(template: BountyTemplate, now: number, rng: Rng = Math.random): ActiveBounty {
  const [min, max] = template.targetRange
  const target = quantizeTarget(template.objective, min + rng() * (max - min))
  const reward = Math.max(1, Math.round(target * template.rewardPerUnit))
  return {
    id: `${template.id}-${Math.floor(now)}-${drawSeq++}`,
    templateId: template.id,
    objective: template.objective,
    title: template.title,
    emoji: template.emoji,
    target,
    progress: 0,
    reward,
    deadline: nextDayStart(now),
    day: dayStart(now),
    ...(template.catalogId !== undefined ? { catalogId: template.catalogId } : {}),
    ...(template.itemId !== undefined ? { itemId: template.itemId } : {}),
  }
}

/** Draw a challenge, preferring a template not already represented on the board. */
function drawFresh(activeTemplateIds: Set<string>, now: number, rng: Rng): ActiveBounty {
  const unused = BOUNTY_TEMPLATES.filter((t) => !activeTemplateIds.has(t.id))
  const pool = unused.length > 0 ? unused : BOUNTY_TEMPLATES
  const template = pool[Math.floor(rng() * pool.length)]
  return drawBounty(template, now, rng)
}

/** Top a (possibly short) same-day board back up to `config.bounties.boardSize`. */
function fillDay(board: ActiveBounty[], now: number, rng: Rng): ActiveBounty[] {
  const next = [...board]
  const seen = new Set(next.map((b) => b.templateId))
  while (next.length < config.bounties.boardSize) {
    const drawn = drawFresh(seen, now, rng)
    next.push(drawn)
    seen.add(drawn.templateId)
  }
  return next
}

/** Draw a full fresh set of daily challenges for the day containing `now`. */
export function seedDailyBounties(now: number, rng: Rng = Math.random): ActiveBounty[] {
  return fillDay([], now, rng)
}

/**
 * Normalise a loaded/reset board to today's challenges: drop any left over from a
 * previous day, seed a fresh full set if nothing remains for today, and top up a
 * short same-day board (e.g. one dropped by a content migration). Used on load /
 * import / reset; runtime day-rollover is handled by `settleBounties`.
 */
export function ensureDailyBoard(board: ActiveBounty[], now: number, rng: Rng = Math.random): ActiveBounty[] {
  const today = dayStart(now)
  // Fast path: an already-full board that all belongs to today is returned as-is.
  if (board.length >= config.bounties.boardSize && board.every((b) => b.day === today)) return board
  const forToday = board.filter((b) => b.day === today)
  if (forToday.length === 0) return seedDailyBounties(now, rng)
  return forToday.length < config.bounties.boardSize ? fillDay(forToday, now, rng) : forToday
}

/**
 * Add `amount` of progress to every active challenge matching (objective, key),
 * returning a NEW board if anything changed and the SAME reference otherwise (so
 * callers can cheaply skip a re-render when nothing moved). `key` is the catalog
 * id for `place`, and the item id for `sell`/`bank`; a `bank` challenge with no
 * `itemId` counts every villager, so it matches any key. A challenge that has
 * already met its target (awaiting settlement, or completed for the day) is
 * skipped.
 */
export function creditBounties(
  board: ActiveBounty[],
  objective: BountyObjective,
  amount: number,
  key?: string,
): ActiveBounty[] {
  if (amount <= 0) return board
  let changed = false
  const next = board.map((b) => {
    if (b.objective !== objective) return b
    if (objective === 'place' && b.catalogId !== key) return b
    if (objective === 'sell' && b.itemId !== key) return b
    if (objective === 'bank' && b.itemId !== undefined && b.itemId !== key) return b
    if (b.progress >= b.target) return b // already met; awaiting settlement / done for the day
    changed = true
    return { ...b, progress: Math.min(b.target, b.progress + amount) }
  })
  return changed ? next : board
}

/**
 * Settle the board at `now`. Two things can happen:
 *  1. Any challenge that met its target and hasn't been paid yet is completed —
 *     its reward tallied, a log entry produced, and it's marked `completedAt` so
 *     it stays on the board (done) without being re-paid or replaced mid-day.
 *  2. If the board belongs to an earlier day, the whole set has expired: it is
 *     replaced with a fresh daily draw for the current day.
 * Never credits progress — it only reads the results of prior `creditBounties`
 * calls. Returns the same board reference when nothing changed, so a no-op settle
 * is free. An empty board is left untouched (test scaffolding); production boards
 * are seeded on load, so they are never empty.
 */
export function settleBounties(board: ActiveBounty[], now: number, rng: Rng = Math.random): BountySettlement {
  if (board.length === 0) return { board, completed: [], reward: 0, changed: false }

  // 1. Bank any newly-met, unpaid challenges (marking them done, not removing).
  const completed: CompletedBounty[] = []
  let reward = 0
  const paid = board.map((b) => {
    if (b.completedAt === undefined && b.progress >= b.target) {
      completed.push({ title: b.title, emoji: b.emoji, reward: b.reward, at: now })
      reward += b.reward
      return { ...b, completedAt: now }
    }
    return b
  })
  const bankedSomething = completed.length > 0

  // 2. Day rollover: the whole set expires together at the day boundary. Replace
  //    it with a fresh draw (any just-banked rewards from step 1 still return).
  if (paid[0].day !== dayStart(now)) {
    return { board: seedDailyBounties(now, rng), completed, reward, changed: true }
  }

  if (!bankedSomething) return { board, completed: [], reward: 0, changed: false }
  return { board: paid, completed, reward, changed: true }
}
