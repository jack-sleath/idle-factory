import { useGameStore } from '../store/gameStore'
import { ITEMS_BY_ID } from '../data'
import { cellKey } from '../game/world'
import { formatShort } from '../lib/format'
import { Emoji } from './Emoji'

/** Round a multiplier to a signed percentage string, e.g. 1.06 → "+6%". */
function pct(multiplier: number): string {
  const delta = Math.round((multiplier - 1) * 100)
  return `${delta >= 0 ? '+' : ''}${delta}%`
}

/**
 * Inspector shown when the Select tool picks a town hall: the villagers this
 * hall has banked (by type), plus the town-wide economic bonuses those
 * villagers produce. Bonuses are global (summed across every hall), so the same
 * "active bonuses" list shows on every hall; the population list is per-hall.
 */
export function TownHallPanel() {
  const selected = useGameStore((s) => s.selected)
  const world = useGameStore((s) => s.world)
  const townHalls = useGameStore((s) => s.townHalls)
  const mods = useGameStore((s) => s.townModifiers)

  if (!selected) return null
  const key = cellKey(selected.x, selected.y)
  const machine = world.get(key)
  if (!machine || machine.kind !== 'townhall') return null

  const counts = townHalls.get(key) ?? {}
  const population = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])

  // Only surface levers that are actually doing something (non-identity).
  const bonuses: string[] = []
  if (mods.sellMultiplier > 1) bonuses.push(`${pct(mods.sellMultiplier)} sell price`)
  if (mods.volatilityMultiplier < 1) {
    bonuses.push(`${pct(mods.volatilityMultiplier)} market volatility (steadier prices)`)
  }
  if (mods.offlineMultiplier > 1) bonuses.push(`${pct(mods.offlineMultiplier)} offline earnings`)
  if (mods.buildCostMultiplier < 1) bonuses.push(`${pct(mods.buildCostMultiplier)} build cost`)
  if ((mods.ceilingMultiplier.food ?? 1) > 1) {
    bonuses.push(`${pct(mods.ceilingMultiplier.food)} food price ceiling`)
  }
  if ((mods.ceilingMultiplier.material ?? 1) > 1) {
    bonuses.push(`${pct(mods.ceilingMultiplier.material)} material / valuable ceiling`)
  }

  return (
    <aside className="panel" aria-label="Town Hall">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="🏛️" size={18} label="town hall" /> Town Hall
        </span>
        <button
          type="button"
          className="panel__close"
          aria-label="Close"
          onClick={() => useGameStore.setState({ selected: null })}
        >
          ✕
        </button>
      </header>

      <div className="panel__body">
        <div className="panel__section-label">Banked here</div>
        {population.length > 0 ? (
          <ul className="townhall__pop">
            {population.map(([id, n]) => {
              const def = ITEMS_BY_ID[id]
              return (
                <li key={id} className="panel__row">
                  <span className="panel__item">
                    <Emoji emoji={def?.emoji ?? '🧑'} size={18} label={def?.name ?? id} />{' '}
                    {def?.name ?? id}
                  </span>
                  <span className="panel__value">{formatShort(n)}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="panel__empty">
            No villagers banked yet — route villagers in to grow the town.
          </p>
        )}

        <div className="panel__section-label">Town bonuses (all halls)</div>
        {bonuses.length > 0 ? (
          <ul className="townhall__bonuses">
            {bonuses.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="panel__empty">No active bonuses yet — bank some typed villagers.</p>
        )}
      </div>
    </aside>
  )
}
