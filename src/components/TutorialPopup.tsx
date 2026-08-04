import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { Emoji } from './Emoji'

/**
 * The one-time tutorial card for a machine kind. The store queues a card the
 * first time the player could build that kind (see `game/tutorials.ts`); this
 * shows the front of the queue and dismissing it banks the card as seen for good,
 * so a burst — the starter kit on a fresh game, or a windfall that unlocks
 * several at once — is read one card at a time.
 *
 * Deliberately modal and dismissible only by the button (or Enter/Escape): it is
 * a handful of cards across a whole save, and each one gates a machine the player
 * is about to spend money on.
 */
export function TutorialPopup() {
  const card = useGameStore((s) => s.tutorials[0])
  const queued = useGameStore((s) => s.tutorials.length)
  const dismiss = useGameStore((s) => s.dismissTutorial)

  // Keyboard dismissal, so a desktop player never has to reach for the mouse.
  useEffect(() => {
    if (!card) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') dismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [card, dismiss])

  if (!card) return null

  return (
    <div className="away-backdrop" role="dialog" aria-label={`Tutorial: ${card.title}`}>
      <aside className="panel panel--away panel--tutorial">
        <header className="panel__head">
          <span className="panel__title">
            <Emoji emoji={card.emoji} size={22} label={card.title} /> {card.title}
          </span>
          <span className="tutorial__badge">New</span>
        </header>
        <ul className="onboard__list tutorial__list">
          {card.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <button type="button" className="save__btn away__collect" onClick={dismiss} autoFocus>
          {queued > 1 ? `Next (${queued - 1} more)` : 'Got it'}
        </button>
      </aside>
    </div>
  )
}
