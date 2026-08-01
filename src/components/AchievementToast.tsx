import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { Emoji } from './Emoji'

/** How long an unlock toast stays on screen before auto-dismissing. */
const TOAST_MS = 5000

/**
 * A transient "Achievement unlocked!" popup. The store queues just-unlocked
 * achievements in `achievementToasts`; this shows the head of the queue, auto-
 * advancing after a few seconds (or immediately on click), so a burst of unlocks
 * plays out one at a time.
 */
export function AchievementToast() {
  const toast = useGameStore((s) => s.achievementToasts[0])
  const dismiss = useGameStore((s) => s.dismissAchievementToast)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(dismiss, TOAST_MS)
    return () => clearTimeout(id)
  }, [toast, dismiss])

  if (!toast) return null

  return (
    <button
      type="button"
      className="ach-toast"
      onClick={dismiss}
      role="status"
      aria-live="polite"
      aria-label={`Achievement unlocked: ${toast.name}`}
    >
      <span className="ach-toast__icon">
        <Emoji emoji={toast.emoji} size={30} label={toast.name} />
      </span>
      <span className="ach-toast__text">
        <span className="ach-toast__head">
          <Emoji emoji="🏆" size={12} label="" /> Achievement unlocked
        </span>
        <span className="ach-toast__name">{toast.name}</span>
        <span className="ach-toast__desc">{toast.description}</span>
      </span>
    </button>
  )
}
