import { useGameStore, type Tool } from '../store/gameStore'
import { CATALOG } from '../data'
import { Emoji } from './Emoji'

const ACTION_TOOLS: { kind: 'select' | 'rotate' | 'delete'; label: string; emoji: string }[] = [
  { kind: 'select', label: 'Select', emoji: '🔍' },
  { kind: 'rotate', label: 'Rotate', emoji: '🔄' },
  { kind: 'delete', label: 'Delete', emoji: '❌' },
]

function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'build' && b.kind === 'build') return a.catalogId === b.catalogId
  return true
}

/**
 * The tool palette / shop: one build button per catalog entry, plus the
 * Select / Rotate / Delete action tools. The active tool determines what
 * tapping a cell does. Costs are shown/enforced from M6.
 */
export function Palette() {
  const tool = useGameStore((s) => s.tool)
  const setTool = useGameStore((s) => s.setTool)

  return (
    <nav className="palette" aria-label="Build tools">
      <div className="palette__group">
        {CATALOG.map((entry) => {
          const t: Tool = { kind: 'build', catalogId: entry.id }
          return (
            <button
              key={entry.id}
              type="button"
              className={`palette__btn${sameTool(t, tool) ? ' is-active' : ''}`}
              onClick={() => setTool(t)}
              title={entry.name}
            >
              <Emoji emoji={entry.emoji} size={26} label={entry.name} />
              <span className="palette__label">{entry.name}</span>
            </button>
          )
        })}
      </div>
      <div className="palette__group palette__group--actions">
        {ACTION_TOOLS.map((action) => {
          const t: Tool = { kind: action.kind }
          return (
            <button
              key={action.kind}
              type="button"
              className={`palette__btn${sameTool(t, tool) ? ' is-active' : ''}`}
              onClick={() => setTool(t)}
              title={action.label}
            >
              <Emoji emoji={action.emoji} size={26} label={action.label} />
              <span className="palette__label">{action.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
