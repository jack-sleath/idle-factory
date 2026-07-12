import { useGameStore } from '../store/gameStore'
import { ITEMS_BY_ID } from '../data'
import { formatDuration, formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

/** "Welcome back" card summarising what happened while the player was away (M9). */
export function AwaySummary() {
  const away = useGameStore((s) => s.lastAway)
  const dismiss = useGameStore((s) => s.dismissAway)
  if (!away) return null

  return (
    <div className="away-backdrop" role="dialog" aria-label="Welcome back">
      <aside className="panel panel--away">
        <header className="panel__head">
          <span className="panel__title">👋 Welcome back</span>
        </header>
        <p className="away__elapsed">Away for {formatDuration(away.elapsedMs)}</p>

        {away.stockpiled.length > 0 && (
          <div className="away__section">
            <span className="panel__muted">Stockpiled</span>
            <ul className="away__items">
              {away.stockpiled.map(({ item, count }) => {
                const def = ITEMS_BY_ID[item]
                return (
                  <li key={item} className="away__item">
                    <Emoji emoji={def?.emoji ?? '❓'} size={18} label={def?.name ?? item} />
                    {formatMoney(count)}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {away.earned > 0 && (
          <p className="away__earned">
            Auto-sellers earned <strong>{formatMoney(away.earned)}</strong>
          </p>
        )}

        <button type="button" className="save__btn away__collect" onClick={dismiss}>
          Collect
        </button>
      </aside>
    </div>
  )
}
