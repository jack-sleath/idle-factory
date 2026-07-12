import { useEffect } from 'react'
import { Emoji } from './components/Emoji'
import { GameCanvas } from './components/GameCanvas'
import { Palette } from './components/Palette'
import { useGameStore } from './store/gameStore'
import './App.css'

/** Persist immediately whenever the tab is hidden or the page is being unloaded. */
function useAutosaveOnHide() {
  useEffect(() => {
    const saveIfHidden = () => {
      if (document.visibilityState === 'hidden') useGameStore.getState().saveNow()
    }
    const saveNow = () => useGameStore.getState().saveNow()
    document.addEventListener('visibilitychange', saveIfHidden)
    window.addEventListener('pagehide', saveNow)
    return () => {
      document.removeEventListener('visibilitychange', saveIfHidden)
      window.removeEventListener('pagehide', saveNow)
    }
  }, [])
}

export default function App() {
  useAutosaveOnHide()

  return (
    <div className="app">
      <header className="hud">
        <span className="hud__title">
          <Emoji emoji="🏭" size={22} label="factory" /> Idle Factory
        </span>
        <span className="hud__hint">Pick a tool, then tap a cell</span>
      </header>
      <main className="stage">
        <GameCanvas />
      </main>
      <Palette />
    </div>
  )
}
