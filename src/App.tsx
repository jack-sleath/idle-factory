import { useEffect, useState } from 'react'
import { Emoji } from './components/Emoji'
import { GameCanvas } from './components/GameCanvas'
import { Palette } from './components/Palette'
import { StoragePanel } from './components/StoragePanel'
import { MarketPanel } from './components/MarketPanel'
import { SaveMenu } from './components/SaveMenu'
import { AwaySummary } from './components/AwaySummary'
import { Onboarding } from './components/Onboarding'
import { useGameLoop } from './hooks/useGameLoop'
import { useMarketLoop } from './hooks/useMarketLoop'
import { useOfflineProgress } from './hooks/useOfflineProgress'
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
  useOfflineProgress()
  useGameLoop()
  useMarketLoop()
  const money = useGameStore((s) => s.money)
  const [marketOpen, setMarketOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  return (
    <div className="app">
      <header className="hud">
        <span className="hud__title">
          <Emoji emoji="🏭" size={22} label="factory" /> Auto-Exportica
        </span>
        <span className="hud__hint">Pick a tool, then tap a cell</span>
        <div className="hud__right">
          <button
            type="button"
            className={`hud__btn${marketOpen ? ' is-active' : ''}`}
            aria-pressed={marketOpen}
            onClick={() => setMarketOpen((open) => !open)}
          >
            <Emoji emoji="📈" size={16} label="market" /> Market
          </button>
          <button
            type="button"
            className={`hud__btn${saveOpen ? ' is-active' : ''}`}
            aria-pressed={saveOpen}
            onClick={() => setSaveOpen((open) => !open)}
          >
            <Emoji emoji="💾" size={16} label="saves" /> Saves
          </button>
          <span className="hud__money" title="Money">
            <Emoji emoji="💰" size={18} label="money" /> {formatMoney(money)}
          </span>
        </div>
      </header>
      <main className="stage">
        <GameCanvas />
        <StoragePanel />
        {marketOpen && <MarketPanel onClose={() => setMarketOpen(false)} />}
        {saveOpen && <SaveMenu onClose={() => setSaveOpen(false)} />}
        <AwaySummary />
        <Onboarding />
      </main>
      <Palette />
    </div>
  )
}
