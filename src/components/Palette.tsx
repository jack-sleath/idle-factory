import { useGameStore, type Tool } from '../store/gameStore'
import { CATALOG } from '../data'
import { countPlaced, effectiveCost } from '../game/economy'
import { formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'build' && b.kind === 'build') return a.catalogId === b.catalogId
  return true
}

/**
 * The tool palette / shop: one build button per catalog entry. The active tool
 * determines what tapping a cell does. Each build button shows its price (or
 * "Free" for a first-of-kind basic) and is disabled when the player can't
 * afford it. The Select / Rotate / Delete tools live in <ActionTools />.
 */
export function Palette() {
  const tool = useGameStore((s) => s.tool)
  const setTool = useGameStore((s) => s.setTool)
  const money = useGameStore((s) => s.money)
  const world = useGameStore((s) => s.world)
  const buildCostMultiplier = useGameStore((s) => s.townModifiers.buildCostMultiplier)
  // worldRev changes whenever the world is mutated in place, so prices/counts
  // recompute even though the `world` Map reference is stable.
  useGameStore((s) => s.worldRev)

  return (
    <nav className="palette" aria-label="Build tools">
      <div className="palette__group">
        {CATALOG.map((entry) => {
          const t: Tool = { kind: 'build', catalogId: entry.id }
          // The full list price, and what the player actually pays after the
          // town-hall mason build-cost discount (matches gameStore.place()).
          const base = effectiveCost(entry, countPlaced(world, entry.id))
          const cost = Math.round(base * buildCostMultiplier)
          const discounted = cost < base
          const affordable = money >= cost
          const title = affordable
            ? entry.name
            : `${entry.name} — costs ${formatMoney(cost)}`
          return (
            <button
              key={entry.id}
              type="button"
              className={`palette__btn${sameTool(t, tool) ? ' is-active' : ''}`}
              onClick={() => setTool(t)}
              disabled={!affordable}
              title={discounted ? `${title} (was ${formatMoney(base)})` : title}
            >
              <Emoji emoji={entry.emoji} size={26} label={entry.name} />
              <span className="palette__label">{entry.name}</span>
              <span className={`palette__cost${cost === 0 ? ' is-free' : ''}`}>
                {cost === 0 ? (
                  'Free'
                ) : discounted ? (
                  <>
                    <span className="palette__cost-orig">{formatMoney(base)}</span>
                    <span className="palette__cost-now">{formatMoney(cost)}</span>
                  </>
                ) : (
                  formatMoney(cost)
                )}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
