import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { Emoji } from './Emoji'

const ACTION_TOOLS: { kind: 'select' | 'rotate' | 'delete'; label: string; emoji: string }[] = [
  { kind: 'select', label: 'Select', emoji: '🔍' },
  { kind: 'rotate', label: 'Rotate', emoji: '🔄' },
  { kind: 'delete', label: 'Delete', emoji: '❌' },
]

/** Ms without any pointer input before a non-Select tool reverts to Select. */
const IDLE_RESET_MS = 60_000

/**
 * The Select / Rotate / Delete action tools, floated in a vertical stack on the
 * right edge of the stage. While any other tool is active, a minute with no
 * pointer input anywhere reverts to Select so a stale Rotate/Delete/build tool
 * can't surprise the player when they come back.
 */
export function ActionTools() {
  const tool = useGameStore((s) => s.tool)
  const setTool = useGameStore((s) => s.setTool)

  useEffect(() => {
    if (tool.kind === 'select') return
    const revert = () => useGameStore.getState().setTool({ kind: 'select' })
    let id = window.setTimeout(revert, IDLE_RESET_MS)
    const reset = () => {
      window.clearTimeout(id)
      id = window.setTimeout(revert, IDLE_RESET_MS)
    }
    window.addEventListener('pointerdown', reset)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', reset)
    }
  }, [tool])

  return (
    <nav className="action-tools" aria-label="Action tools">
      {ACTION_TOOLS.map((action) => (
        <button
          key={action.kind}
          type="button"
          className={`palette__btn${tool.kind === action.kind ? ' is-active' : ''}`}
          onClick={() => setTool({ kind: action.kind })}
          title={action.label}
        >
          <Emoji emoji={action.emoji} size={26} label={action.label} />
          <span className="palette__label">{action.label}</span>
        </button>
      ))}
    </nav>
  )
}
