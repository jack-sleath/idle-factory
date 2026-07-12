import { useGameStore } from '../store/gameStore'
import { ITEMS } from '../data'
import { formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

const SPARK_W = 88
const SPARK_H = 24
const SPARK_PAD = 3

/** A tiny inline-SVG line chart of an item's recent prices. */
function Sparkline({ values, crashed }: { values: number[]; crashed: boolean }) {
  const stroke = crashed ? '#ff6b6b' : '#6ee7a8'
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const n = values.length
  const x = (i: number) => (n <= 1 ? SPARK_W / 2 : SPARK_PAD + (i / (n - 1)) * (SPARK_W - 2 * SPARK_PAD))
  const y = (v: number) => SPARK_PAD + (1 - (v - min) / span) * (SPARK_H - 2 * SPARK_PAD)

  return (
    <svg className="spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true">
      {n <= 1 ? (
        <circle cx={SPARK_W / 2} cy={SPARK_H / 2} r={2} fill={stroke} />
      ) : (
        <polyline
          points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

/** The stock-market panel: live price and a last-10 sparkline for every item. */
export function MarketPanel({ onClose }: { onClose: () => void }) {
  const market = useGameStore((s) => s.market)

  return (
    <aside className="panel panel--market" aria-label="Market">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="📈" size={18} label="market" /> Market
        </span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <ul className="market__list">
        {ITEMS.map((it) => {
          const m = market.items[it.id]
          if (!m) return null
          return (
            <li key={it.id} className="market__row">
              <span className="market__item">
                <Emoji emoji={it.emoji} size={18} label={it.name} />
              </span>
              <span className={`market__price${m.crashed ? ' is-crashed' : ''}`}>
                {formatMoney(m.price)}
                {m.crashed && (
                  <span className="market__crash" title="Crashed — reset to base value">
                    ⚠︎
                  </span>
                )}
              </span>
              <Sparkline values={m.history} crashed={m.crashed} />
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
