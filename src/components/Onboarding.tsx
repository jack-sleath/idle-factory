import { useState } from 'react'

const ONBOARDED_KEY = 'idle-factory/onboarded'

function alreadyOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A one-time "how to play" card shown on first run and dismissed for good via a
 * localStorage flag. Deliberately tiny — the full HUD hint stays visible after.
 */
export function Onboarding() {
  const [dismissed, setDismissed] = useState(alreadyOnboarded)
  if (dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      // Ignore storage failures; the card just reappears next load.
    }
    setDismissed(true)
  }

  return (
    <div className="away-backdrop" role="dialog" aria-label="How to play">
      <aside className="panel panel--away">
        <header className="panel__head">
          <span className="panel__title">🏭 How to play</span>
        </header>
        <ul className="onboard__list">
          <li><strong>Tap</strong> a cell to build with the selected tool.</li>
          <li><strong>Drag</strong> to pan, <strong>pinch</strong> or scroll to zoom.</li>
          <li>Pick <strong>Rotate</strong>/<strong>Delete</strong> to turn or remove machines.</li>
          <li><strong>Select</strong> a storage to sell its stockpile for money.</li>
        </ul>
        <button type="button" className="save__btn away__collect" onClick={dismiss}>
          Got it
        </button>
      </aside>
    </div>
  )
}
