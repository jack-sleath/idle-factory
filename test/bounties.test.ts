import { describe, it, expect } from 'vitest'
import {
  drawBounty,
  seedBounties,
  refillBounties,
  creditBounties,
  settleBounties,
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
  durationMinutes: 20,
}

/** A minimal active bounty for the crediting/settling tests. */
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
    deadline: NOW + 60_000,
    ...overrides,
  }
}

describe('drawBounty', () => {
  it('rolls a target in range, quantizes earn to 1000s, and sets reward + deadline', () => {
    const b = drawBounty(EARN_TEMPLATE, NOW, () => 0) // min end of the range
    expect(b.target).toBe(10000)
    expect(b.reward).toBe(Math.round(10000 * 0.08)) // 800
    expect(b.progress).toBe(0)
    expect(b.deadline).toBe(NOW + 20 * 60_000)
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
      durationMinutes: 20,
    }
    const b = drawBounty(template, NOW, () => 0.99)
    expect(Number.isInteger(b.target)).toBe(true)
    expect(b.target).toBeGreaterThanOrEqual(3)
    expect(b.target).toBeLessThanOrEqual(6)
    expect(b.catalogId).toBe('seller-basic')
  })
})

describe('seedBounties / refillBounties', () => {
  it('seeds a full board of distinct templates', () => {
    const board = seedBounties(NOW, () => 0)
    expect(board).toHaveLength(config.bounties.boardSize)
    const templateIds = board.map((b) => b.templateId)
    expect(new Set(templateIds).size).toBe(templateIds.length) // no duplicates
  })

  it('tops a short board back up to full without touching existing entries', () => {
    const existing = seedBounties(NOW, () => 0).slice(0, 1)
    const refilled = refillBounties(existing, NOW, () => 0.3)
    expect(refilled).toHaveLength(config.bounties.boardSize)
    expect(refilled[0]).toBe(existing[0]) // kept by reference
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
})

describe('settleBounties', () => {
  it('completes a met bounty, banks its reward, and refills the slot', () => {
    const board = [active({ progress: 100, target: 100, reward: 500 })]
    const result = settleBounties(board, NOW, () => 0)
    expect(result.changed).toBe(true)
    expect(result.reward).toBe(500)
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].reward).toBe(500)
    expect(result.board).toHaveLength(config.bounties.boardSize) // refilled
    expect(result.board.some((b) => b.id === 'b1')).toBe(false) // the met one is gone
  })

  it('drops an expired unmet bounty (no reward) and refills', () => {
    const board = [active({ progress: 10, target: 100, deadline: NOW - 1 })]
    const result = settleBounties(board, NOW, () => 0.5)
    expect(result.changed).toBe(true)
    expect(result.reward).toBe(0)
    expect(result.completed).toHaveLength(0)
    expect(result.board).toHaveLength(config.bounties.boardSize)
  })

  it('is a no-op (same board reference) when nothing is met or expired', () => {
    const board = [active({ progress: 10, target: 100, deadline: NOW + 60_000 })]
    const result = settleBounties(board, NOW, () => 0)
    expect(result.changed).toBe(false)
    expect(result.board).toBe(board)
    expect(result.completed).toHaveLength(0)
  })
})
