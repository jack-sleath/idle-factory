import type { Rng } from './market'
import { BOUNTY_TEMPLATES } from '../data'
import { config } from '../data/config'

// Bounty board (a rotating set of short, timed objectives that pay a one-time
// coin bounty). The board holds `config.bounties.boardSize` active bounties; when
// one is completed or its deadline passes it is dropped and a fresh one is drawn
// to keep the board full.
//
// Design (see the achievements/bounty discussion): the reward is always a flat,
// one-time coin payout sized as a *garnish* on factory income — never a
// permanent multiplier (those stay the town hall's job) — so a recurring board
// can't distort the income/cost race the economy is tuned around.
//
// Deadlines burn in real (wall-clock) time whether the player is online or not,
// but PROGRESS only accrues during active play: callers advance `progress` on
// the relevant gameplay events (coins earned, machines placed, villagers banked)
// and offline catch-up never credits it. So the board is a hands-on feature —
// closing the tab lets bounties expire but never completes them.

/** What a bounty measures. */
export type BountyObjective =
  | 'earn' // total coins banked from sales (auto-sellers + Sell-All)
  | 'place' // machines built of a given catalog id
  | 'bank' // villagers banked into town halls (a specific type, or any)

/** A bounty definition (from data/bounties.json); the board draws instances from these. */
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
  /** How long the player has, in real minutes, from when the bounty is drawn. */
  durationMinutes: number
  /** `place` only: the catalog id whose placements count. */
  catalogId?: string
  /** `bank` only: a specific villager item id, or omitted to count ANY villager. */
  itemId?: string
}

/** A live bounty on the board (persisted in the save). */
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
  /** Wall-clock ms timestamp after which the bounty expires unmet. */
  deadline: number
  catalogId?: string
  itemId?: string
}

/** A finished bounty, kept for the completed list (most-recent first). */
export interface CompletedBounty {
  title: string
  emoji: string
  reward: number
  /** Wall-clock ms timestamp it was banked. */
  at: number
}

/** Result of settling the board: the refilled board plus any payouts to apply. */
export interface BountySettlement {
  board: ActiveBounty[]
  completed: CompletedBounty[]
  reward: number
  /** True if any slot was removed (completed or expired) and refilled. */
  changed: boolean
}

// Monotonic per-session counter so two bounties drawn in the same millisecond
// still get distinct ids (ids only need to be unique within a session).
let drawSeq = 0

/** Round a rolled target to a tidy value: earn to the nearest 1000, counts to whole units. */
function quantizeTarget(objective: BountyObjective, raw: number): number {
  if (objective === 'earn') return Math.max(1000, Math.round(raw / 1000) * 1000)
  return Math.max(1, Math.round(raw))
}

/** Draw a concrete bounty instance from a template at time `now`. */
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
    deadline: now + template.durationMinutes * 60_000,
    ...(template.catalogId !== undefined ? { catalogId: template.catalogId } : {}),
    ...(template.itemId !== undefined ? { itemId: template.itemId } : {}),
  }
}

/** Draw a bounty, preferring a template not already represented on the board. */
function drawFresh(activeTemplateIds: Set<string>, now: number, rng: Rng): ActiveBounty {
  const unused = BOUNTY_TEMPLATES.filter((t) => !activeTemplateIds.has(t.id))
  const pool = unused.length > 0 ? unused : BOUNTY_TEMPLATES
  const template = pool[Math.floor(rng() * pool.length)]
  return drawBounty(template, now, rng)
}

/** Top a (possibly short) board back up to `config.bounties.boardSize`. */
export function refillBounties(board: ActiveBounty[], now: number, rng: Rng = Math.random): ActiveBounty[] {
  const next = [...board]
  const seen = new Set(next.map((b) => b.templateId))
  while (next.length < config.bounties.boardSize) {
    const drawn = drawFresh(seen, now, rng)
    next.push(drawn)
    seen.add(drawn.templateId)
  }
  return next
}

/** Seed a full fresh board (new game / reset). */
export function seedBounties(now: number, rng: Rng = Math.random): ActiveBounty[] {
  return refillBounties([], now, rng)
}

/**
 * Add `amount` of progress to every active bounty matching (objective, key),
 * returning a NEW board if anything changed and the SAME reference otherwise (so
 * callers can cheaply skip a re-render when nothing moved). `key` is the catalog
 * id for `place` and the villager item id for `bank`; a `bank` bounty with no
 * `itemId` counts every villager, so it matches any key.
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
    if (objective === 'bank' && b.itemId !== undefined && b.itemId !== key) return b
    if (b.progress >= b.target) return b // already met; awaiting settlement
    changed = true
    return { ...b, progress: Math.min(b.target, b.progress + amount) }
  })
  return changed ? next : board
}

/**
 * Settle the board at `now`: bounties that met their target are completed (their
 * reward tallied and a log entry produced), bounties past their deadline are
 * dropped, and any removed slot is refilled. Never credits progress — it only
 * reads the results of prior `creditBounties` calls. Returns the same board
 * reference when nothing was removed, so a no-op settle is free.
 */
export function settleBounties(board: ActiveBounty[], now: number, rng: Rng = Math.random): BountySettlement {
  const kept: ActiveBounty[] = []
  const completed: CompletedBounty[] = []
  let reward = 0
  for (const b of board) {
    if (b.progress >= b.target) {
      completed.push({ title: b.title, emoji: b.emoji, reward: b.reward, at: now })
      reward += b.reward
    } else if (now >= b.deadline) {
      // expired unmet — dropped silently
    } else {
      kept.push(b)
    }
  }
  if (kept.length === board.length) return { board, completed: [], reward: 0, changed: false }
  return { board: refillBounties(kept, now, rng), completed, reward, changed: true }
}
