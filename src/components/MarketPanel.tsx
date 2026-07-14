import { Fragment, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { ITEMS } from '../data'
import { ITEM_CATEGORIES, type ItemCategory } from '../game/types'
import { formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

/** Display label + icon per category; iteration order follows ITEM_CATEGORIES. */
const CATEGORY_META: Record<ItemCategory, { label: string; emoji: string }> = {
  food: { label: 'Food', emoji: '🍽️' },
  drink: { label: 'Drink', emoji: '🥤' },
  valuable: { label: 'Valuables', emoji: '💎' },
  weapon: { label: 'Weapons', emoji: '⚔️' },
  material: { label: 'Materials', emoji: '🧱' },
  misc: { label: 'Misc', emoji: '📦' },
}

const SPARK_W = 56
const SPARK_H = 20
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

/**
 * The stock-market panel: live price and a last-10 sparkline for every item,
 * grouped under sticky category headers (Food, Drink, Valuables, …). The search
 * box matches anywhere in the name, so "ruby" surfaces the stone and every ruby
 * ring and amulet; empty categories drop out of the list while searching.
 */
export function MarketPanel({ onClose }: { onClose: () => void }) {
  const market = useGameStore((s) => s.market)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = q ? ITEMS.filter((it) => it.name.toLowerCase().includes(q)) : ITEMS

  // Group into category sections, preserving ITEM_CATEGORIES order and dropping
  // items with no live market entry (and any category left empty).
  const groups = ITEM_CATEGORIES.map((cat) => ({
    cat,
    items: shown.filter((it) => it.category === cat && market.items[it.id]),
  })).filter((g) => g.items.length > 0)

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
      <input
        type="search"
        className="market__search"
        placeholder="Search items…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search items"
      />
      <ul className="market__list">
        {groups.map((g) => (
          <Fragment key={g.cat}>
            <li className="market__section">
              <Emoji emoji={CATEGORY_META[g.cat].emoji} size={13} label="" />
              <span className="market__section-label">{CATEGORY_META[g.cat].label}</span>
              <span className="market__section-count">{g.items.length}</span>
            </li>
            {g.items.map((it) => {
              const m = market.items[it.id]!
              return (
                <li key={it.id} className="market__row">
                  <Emoji emoji={it.emoji} size={16} label={it.name} />
                  <span className="market__name" title={it.name}>
                    {it.name}
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
          </Fragment>
        ))}
        {groups.length === 0 && <li className="market__empty">No items match “{query}”.</li>}
      </ul>
    </aside>
  )
}
