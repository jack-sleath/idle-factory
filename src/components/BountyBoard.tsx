import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { CATALOG_BY_ID, ITEMS_BY_ID } from '../data'
import type { ActiveBounty } from '../game/bounties'
import { formatDuration, formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

/** A concrete one-line description of what a bounty asks for. */
function goalLabel(b: ActiveBounty): string {
  switch (b.objective) {
    case 'earn':
      return 'Earn coins from sales'
    case 'place':
      return `Build ${CATALOG_BY_ID[b.catalogId ?? '']?.name ?? 'machines'}`
    case 'bank':
      return b.itemId ? `Recruit ${ITEMS_BY_ID[b.itemId]?.name ?? 'villagers'}` : 'Recruit villagers'
  }
}

/**
 * The bounty board: a rotating set of timed objectives (see `game/bounties.ts`).
 * Deadlines count down in real time — a local 1s clock drives the countdown so it
 * ticks even between simulation frames — while progress only advances during
 * active play. Completing one banks a flat coin reward and logs it below; a
 * completed or expired bounty is replaced by the store to keep the board full.
 */
export function BountyBoard({ onClose }: { onClose: () => void }) {
  const bounties = useGameStore((s) => s.bounties)
  const completed = useGameStore((s) => s.completedBounties)
  const completedTotal = useGameStore((s) => s.bountiesCompletedTotal)

  // A once-a-second wall clock so the countdowns stay live independent of ticks.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <aside className="panel panel--bounties" aria-label="Bounty board">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="📋" size={18} label="bounties" /> Bounties
        </span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="panel__body">
        <ul className="bounty__list">
          {bounties.map((b) => {
            const remaining = b.deadline - now
            const done = b.progress >= b.target
            const pct = Math.max(0, Math.min(100, (b.progress / b.target) * 100))
            return (
              <li key={b.id} className="bounty">
                <div className="bounty__top">
                  <Emoji emoji={b.emoji} size={18} label="" />
                  <span className="bounty__name" title={b.title}>
                    {b.title}
                  </span>
                  <span className="bounty__reward" title="Reward">
                    <Emoji emoji="💰" size={12} label="reward" />
                    {formatMoney(b.reward)}
                  </span>
                </div>
                <div className="bounty__meta">
                  <span className="bounty__goal">{goalLabel(b)}</span>
                  <span
                    className={`bounty__timer${!done && remaining < 60_000 ? ' is-urgent' : ''}`}
                    title="Time remaining"
                  >
                    ⏳ {remaining > 0 ? formatDuration(remaining) : 'expiring…'}
                  </span>
                </div>
                <div className="bounty__bar" role="progressbar" aria-valuenow={Math.floor(pct)}>
                  <div className={`bounty__fill${done ? ' is-done' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="bounty__progress">
                  {done ? 'Complete — banking…' : `${formatMoney(Math.floor(b.progress))} / ${formatMoney(b.target)}`}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="bounty__log-head">
          <span>
            <Emoji emoji="✅" size={13} label="" /> Completed
          </span>
          <span className="bounty__log-count">{completedTotal}</span>
        </div>
        {completed.length === 0 ? (
          <p className="panel__empty">Finish a bounty to log it here.</p>
        ) : (
          <ul className="bounty__log">
            {completed.slice(0, 8).map((c, i) => (
              <li key={i} className="bounty__log-row">
                <Emoji emoji={c.emoji} size={14} label="" />
                <span className="bounty__log-title" title={c.title}>
                  {c.title}
                </span>
                <span className="bounty__log-reward">+{formatMoney(c.reward)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
