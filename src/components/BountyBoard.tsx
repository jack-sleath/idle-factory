import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { CATALOG_BY_ID, ITEMS_BY_ID } from '../data'
import type { ActiveBounty } from '../game/bounties'
import { formatDuration, formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

/** A concrete one-line description of what a challenge asks for. */
function goalLabel(b: ActiveBounty): string {
  switch (b.objective) {
    case 'earn':
      return 'Earn coins from sales'
    case 'sell':
      return `Sell ${ITEMS_BY_ID[b.itemId ?? '']?.name ?? 'goods'}`
    case 'place':
      return `Build ${CATALOG_BY_ID[b.catalogId ?? '']?.name ?? 'machines'}`
    case 'bank':
      return b.itemId ? `Recruit ${ITEMS_BY_ID[b.itemId]?.name ?? 'villagers'}` : 'Recruit villagers'
  }
}

/**
 * Daily challenges: a set of harder objectives that refresh once a day (see
 * `game/bounties.ts`). The whole set shares one deadline — the next local
 * midnight — so a single "Resets in…" countdown drives the board (a local 1s
 * clock keeps it live between simulation frames), while progress only advances
 * during active play. Completing one banks a flat coin reward, logs it below, and
 * leaves it on the board marked done; the set is redrawn at the daily reset.
 */
export function BountyBoard({ onClose }: { onClose: () => void }) {
  const bounties = useGameStore((s) => s.bounties)
  const completed = useGameStore((s) => s.completedBounties)
  const completedTotal = useGameStore((s) => s.bountiesCompletedTotal)

  // A once-a-second wall clock so the reset countdown stays live independent of ticks.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Every challenge shares the day's deadline, so one countdown covers the board.
  const resetsIn = bounties.length > 0 ? Math.max(0, bounties[0].deadline - now) : 0

  return (
    <aside className="panel panel--bounties" aria-label="Daily challenges">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="📋" size={18} label="daily challenges" /> Daily Challenges
        </span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="panel__body">
        <div className="bounty__reset" title="Time until the challenges refresh">
          🔄 Resets in {formatDuration(resetsIn)}
        </div>
        <ul className="bounty__list">
          {bounties.map((b) => {
            const done = b.completedAt !== undefined || b.progress >= b.target
            const pct = Math.max(0, Math.min(100, (b.progress / b.target) * 100))
            return (
              <li key={b.id} className={`bounty${done ? ' is-done' : ''}`}>
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
                  {done && <span className="bounty__done">✅ Done</span>}
                </div>
                <div className="bounty__bar" role="progressbar" aria-valuenow={Math.floor(pct)}>
                  <div className={`bounty__fill${done ? ' is-done' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="bounty__progress">
                  {done ? 'Complete' : `${formatMoney(Math.floor(b.progress))} / ${formatMoney(b.target)}`}
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
          <p className="panel__empty">Finish a challenge to log it here.</p>
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
