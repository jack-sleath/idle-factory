import { useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { ACHIEVEMENTS } from '../game/achievements'
import { formatDuration } from '../lib/format'
import { Emoji } from './Emoji'

/**
 * The trophy cabinet: every achievement, unlocked ones lit up (with the date
 * earned) and the rest shown locked with their hint. Achievements are permanent,
 * one-time recognitions for specific feats (see `game/achievements.ts`) — unlike
 * the daily bounty board, there is no timer, no reward, and nothing to redraw.
 *
 * Like the market and recipe book, the header/count/search stay put and only the
 * roster scrolls, so the close button is always reachable.
 */
export function AchievementsPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const unlocked = useGameStore((s) => s.unlockedAchievements)
  const unlockedById = new Map(unlocked.map((u) => [u.id, u.at]))
  const earnedCount = ACHIEVEMENTS.filter((a) => unlockedById.has(a.id)).length

  // Unlocked first (newest at the top), then the locked ones in roster order.
  const ordered = [...ACHIEVEMENTS].sort((a, b) => {
    const at = unlockedById.get(a.id)
    const bt = unlockedById.get(b.id)
    if (at !== undefined && bt !== undefined) return bt - at
    if (at !== undefined) return -1
    if (bt !== undefined) return 1
    return 0
  })

  // Name or hint, so searching for a feat ("grapes") finds it as well as a title.
  const term = query.trim().toLowerCase()
  const shown = term
    ? ordered.filter(
        (a) => a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term),
      )
    : ordered

  return (
    <aside className="panel panel--achievements" aria-label="Achievements">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="🏆" size={18} label="achievements" /> Achievements
        </span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="ach__count" title="Achievements unlocked">
        {earnedCount} / {ACHIEVEMENTS.length} unlocked
      </div>
      <input
        type="search"
        className="market__search"
        placeholder="Search achievements…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search achievements"
      />
      <ul className="ach__list">
        {shown.map((a) => {
          const at = unlockedById.get(a.id)
          const done = at !== undefined
          return (
            <li key={a.id} className={`ach${done ? ' is-done' : ' is-locked'}`}>
              <span className="ach__icon" aria-hidden={!done}>
                {done ? (
                  <Emoji emoji={a.emoji} size={22} label={a.name} />
                ) : (
                  <Emoji emoji="🔒" size={18} label="locked" />
                )}
              </span>
              <div className="ach__text">
                <span className="ach__name">{a.name}</span>
                <span className="ach__desc">{a.description}</span>
                {done && <span className="ach__earned">✅ Unlocked {agoLabel(at)}</span>}
              </div>
            </li>
          )
        })}
        {shown.length === 0 && <li className="market__empty">No achievements match “{query}”.</li>}
      </ul>
    </aside>
  )
}

/** "just now" / "3h ago" style relative label for an unlock timestamp. */
function agoLabel(at: number): string {
  const ms = Date.now() - at
  if (ms < 60_000) return 'just now'
  return `${formatDuration(ms)} ago`
}
