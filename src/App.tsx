import { useEffect } from 'react'
import { Emoji } from './components/Emoji'
import { GameCanvas } from './components/GameCanvas'
import { Palette } from './components/Palette'
import { StoragePanel } from './components/StoragePanel'
import { useGameLoop } from './hooks/useGameLoop'
import { useGameStore } from './store/gameStore'
import { formatMoney } from './lib/format'
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
  useGameLoop()
  const money = useGameStore((s) => s.money)

  return (
    <div className="app">
      <header className="hud">
        <span className="hud__title">
          <Emoji emoji="🏭" size={22} label="factory" /> Idle Factory
        </span>
        <span className="hud__hint">Pick a tool, then tap a cell</span>
        <span className="hud__money" title="Money">
          <Emoji emoji="💰" size={18} label="money" /> {formatMoney(money)}
        </span>
      </header>
      <main className="stage">
        <GameCanvas />
        <StoragePanel />
      </main>
      <Palette />
    </div>
  )
}
