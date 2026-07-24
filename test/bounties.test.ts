import { describe, it, expect } from 'vitest'
import {
  drawBounty,
  seedDailyBounties,
  ensureDailyBoard,
  creditBounties,
  settleBounties,
  dayStart,
  nextDayStart,
  type ActiveBounty,
  type BountyTemplate,
} from '../src/game/bounties'
import { config } from '../src/data/config'

const NOW = 1_000_000

const EARN_TEMPLATE: BountyTemplate = {
  id: 'earn-x',
  objective: 'earn',
  title: 'Earn',
  emoji: '💰',
  targetRange: [10000, 40000],
  rewardPerUnit: 0.08,
}

/** A minimal active challenge for the crediting/settling tests (belongs to today). */
function active(overrides: Partial<ActiveBounty>): ActiveBounty {
  return {
    id: 'b1',
    templateId: 't',
    objective: 'earn',
    title: 'Test',
    emoji: '💰',
    target: 100,
    progress: 0,
    reward: 500,
    deadline: nextDayStart(NOW),
    day: dayStart(NOW),
    ...overrides,
  }
}

describe('drawBounty', () => {
  it('rolls a target in range, quantizes earn to 1000s, and deadlines at the next day', () => {
    const b = drawBounty(EARN_TEMPLATE, NOW, () => 0) // min end of the range
    expect(b.target).toBe(10000)
    expect(b.reward).toBe(Math.round(10000 * 0.08)) // 800
    expect(b.progress).toBe(0)
    expect(b.completedAt).toBeUndefined()
    expect(b.deadline).toBe(nextDayStart(NOW))
    expect(b.day).toBe(dayStart(NOW))
    expect(b.objective).toBe('earn')
  })

  it('rounds count objectives to whole units', () => {
    const template: BountyTemplate = {
      id: 'place-x',
      objective: 'place',
      catalogId: 'seller-basic',
      title: 'Build',
      emoji: '🧾',
      targetRange: [3, 6],
      rewardPerUnit: 500,
    }
    const b = drawBounty(template, NOW, () => 0.99)
    expect(Number.isInteger(b.target)).toBe(true)
    expect(b.target).toBeGreaterThanOrEqual(3)
    expect(b.target).toBeLessThanOrEqual(6)
    expect(b.catalogId).toBe('seller-basic')
  })
})

describe('day helpers', () => {
  it('nextDayStart is exactly one day boundary after dayStart', () => {
    expect(nextDayStart(NOW)).toBeGreaterThan(dayStart(NOW))
    // A timestamp inside the same day shares the same dayStart.
    expect(dayStart(NOW)).toBe(dayStart(NOW + 3600_000))
  })
})

describe('seedDailyBounties / ensureDailyBoard', () => {
  it('seeds a full board of distinct templates for the day', () => {
    const board = seedDailyBounties(NOW, () => 0)
    expect(board).toHaveLength(config.bounties.boardSize)
    const templateIds = board.map((b) => b.templateId)
    expect(new Set(templateIds).size).toBe(templateIds.length) // no duplicates
    expect(board.every((b) => b.day === dayStart(NOW))).toBe(true)
  })

  it('keeps a full same-day board as-is', () => {
    const board = seedDailyBounties(NOW, () => 0)
    expect(ensureDailyBoard(board, NOW, () => 0.3)).toBe(board)
  })

  it('tops a short same-day board back up to full without touching existing entries', () => {
    const existing = seedDailyBounties(NOW, () => 0).slice(0, 1)
    const refilled = ensureDailyBoard(existing, NOW, () => 0.3)
    expect(refilled).toHaveLength(config.bounties.boardSize)
    expect(refilled[0]).toBe(existing[0]) // kept by reference
  })

  it('discards a board left over from a previous day and seeds a fresh one', () => {
    const yesterday = seedDailyBounties(NOW, () => 0)
    const tomorrow = NOW + 24 * 60 * 60 * 1000
    const board = ensureDailyBoard(yesterday, tomorrow, () => 0)
    expect(board).toHaveLength(config.bounties.boardSize)
    expect(board.every((b) => b.day === dayStart(tomorrow))).toBe(true)
    expect(board.some((b) => yesterday.includes(b))).toBe(false)
  })
})

describe('creditBounties', () => {
  it('adds earn progress and clamps at the target', () => {
    const board = [active({ objective: 'earn', target: 100, progress: 90 })]
    const next = creditBounties(board, 'earn', 50)
    expect(next[0].progress).toBe(100) // clamped, not 140
    expect(next).not.toBe(board) // new reference on change
  })

  it('matches place bounties by catalog id only', () => {
    const board = [
      active({ objective: 'place', catalogId: 'belt-basic', target: 5 }),
      active({ objective: 'place', catalogId: 'seller-basic', target: 5 }),
    ]
    const next = creditBounties(board, 'place', 1, 'belt-basic')
    expect(next[0].progress).toBe(1)
    expect(next[1].progress).toBe(0) // different catalog id untouched
  })

  it('matches sell bounties by item id', () => {
    const board = [
      active({ objective: 'sell', itemId: 'bread', target: 10 }),
      active({ objective: 'sell', itemId: 'pizza', target: 10 }),
    ]
    const next = creditBounties(board, 'sell', 3, 'bread')
    expect(next[0].progress).toBe(3)
    expect(next[1].progress).toBe(0) // different item untouched
  })

  it('credits a typed bank bounty only for its villager, but an untyped one for any', () => {
    const board = [
      active({ objective: 'bank', itemId: 'merchant', target: 5 }),
      active({ objective: 'bank', itemId: undefined, target: 5 }),
    ]
    const afterGuard = creditBounties(board, 'bank', 1, 'guard')
    expect(afterGuard[0].progress).toBe(0) // merchant bounty ignores a guard
    expect(afterGuard[1].progress).toBe(1) // any-villager bounty counts it
  })

  it('returns the same reference when nothing matches (no re-render)', () => {
    const board = [active({ objective: 'earn' })]
    expect(creditBounties(board, 'place', 1, 'belt-basic')).toBe(board)
    expect(creditBounties(board, 'earn', 0)).toBe(board) // zero amount
  })

  it('does not credit an already-completed challenge', () => {
    const board = [active({ objective: 'earn', target: 100, progress: 100, completedAt: NOW })]
    expect(creditBounties(board, 'earn', 50)).toBe(board)
  })
})

describe('settleBounties', () => {
  it('completes a met challenge, banks its reward, and keeps it on the board marked done', () => {
    const board = [active({ progress: 100, target: 100, reward: 500 })]
    const result = settleBounties(board, NOW, () => 0)
    expect(result.changed).toBe(true)
    expect(result.reward).toBe(500)
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].reward).toBe(500)
    // The completed challenge stays (marked done), not removed or replaced.
    expect(result.board).toHaveLength(1)
    const done = result.board.find((b) => b.id === 'b1')
    expect(done?.completedAt).toBe(NOW)
  })

  it('does not re-bank an already-completed challenge on a later settle', () => {
    const board = [active({ progress: 100, target: 100, reward: 500, completedAt: NOW })]
    const result = settleBounties(board, NOW, () => 0)
    expect(result.changed).toBe(false)
    expect(result.board).toBe(board)
    expect(result.reward).toBe(0)
    expect(result.completed).toHaveLength(0)
  })

  it('redraws the whole set when the day rolls over (unmet ones just expire)', () => {
    const board = [active({ progress: 10, target: 100 })]
    const tomorrow = NOW + 24 * 60 * 60 * 1000
    const result = settleBounties(board, tomorrow, () => 0.5)
    expect(result.changed).toBe(true)
    expect(result.reward).toBe(0) // nothing met
    expect(result.completed).toHaveLength(0)
    expect(result.board).toHaveLength(config.bounties.boardSize)
    expect(result.board.every((b) => b.day === dayStart(tomorrow))).toBe(true)
  })

  it('banks a challenge met right at the day boundary while redrawing the set', () => {
    const board = [active({ progress: 100, target: 100, reward: 500 })]
    const tomorrow = NOW + 24 * 60 * 60 * 1000
    const result = settleBounties(board, tomorrow, () => 0)
    expect(result.reward).toBe(500) // still paid
    expect(result.completed).toHaveLength(1)
    // ...and the board is a fresh set for the new day.
    expect(result.board).toHaveLength(config.bounties.boardSize)
    expect(result.board.every((b) => b.day === dayStart(tomorrow))).toBe(true)
  })

  it('is a no-op (same board reference) when nothing is met and the day has not rolled over', () => {
    const board = [active({ progress: 10, target: 100 })]
    const result = settleBounties(board, NOW + 60_000, () => 0)
    expect(result.changed).toBe(false)
    expect(result.board).toBe(board)
    expect(result.completed).toHaveLength(0)
  })

  it('leaves an empty board untouched (test scaffolding)', () => {
    const result = settleBounties([], NOW, () => 0)
    expect(result.changed).toBe(false)
    expect(result.board).toEqual([])
  })
})
