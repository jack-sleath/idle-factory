import { useEffect, useState } from 'react'
import { Emoji } from './components/Emoji'
import { GameCanvas } from './components/GameCanvas'
import { ActionTools } from './components/ActionTools'
import { Palette } from './components/Palette'
import { StoragePanel } from './components/StoragePanel'
import { TownHallPanel } from './components/TownHallPanel'
import { TeleporterPanel } from './components/TeleporterPanel'
import { MarketPanel } from './components/MarketPanel'
import { BountyBoard } from './components/BountyBoard'
import { RecipeBook } from './components/RecipeBook'
import { SaveMenu } from './components/SaveMenu'
import { AwaySummary } from './components/AwaySummary'
import { Onboarding } from './components/Onboarding'
import { AdminScreen } from './components/AdminScreen'
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

/** Track the URL hash so the dev-only admin screen can gate on `#admin`. */
function useHash(): string {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''))
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  useAutosaveOnHide()
  useOfflineProgress()
  useGameLoop()
  useMarketLoop()
  const money = useGameStore((s) => s.money)
  const [marketOpen, setMarketOpen] = useState(false)
  const [bountiesOpen, setBountiesOpen] = useState(false)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const adminOpen = useHash() === '#admin'

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
            aria-label="Market"
            title="Market"
            onClick={() => setMarketOpen((open) => !open)}
          >
            <Emoji emoji="📈" size={18} label="market" />
          </button>
          <button
            type="button"
            className={`hud__btn${bountiesOpen ? ' is-active' : ''}`}
            aria-pressed={bountiesOpen}
            aria-label="Bounties"
            title="Bounties"
            onClick={() => setBountiesOpen((open) => !open)}
          >
            <Emoji emoji="📋" size={18} label="bounties" />
          </button>
          <button
            type="button"
            className={`hud__btn${recipeOpen ? ' is-active' : ''}`}
            aria-pressed={recipeOpen}
            aria-label="Recipe book"
            title="Recipe book"
            onClick={() => setRecipeOpen((open) => !open)}
          >
            <Emoji emoji="📖" size={18} label="recipe book" />
          </button>
          <button
            type="button"
            className={`hud__btn${saveOpen ? ' is-active' : ''}`}
            aria-pressed={saveOpen}
            aria-label="Saves"
            title="Saves"
            onClick={() => setSaveOpen((open) => !open)}
          >
            <Emoji emoji="💾" size={18} label="saves" />
          </button>
          <span className="hud__money" title="Money">
            <Emoji emoji="💰" size={18} label="money" />
            <span className="hud__money-value">{formatMoney(money)}</span>
          </span>
        </div>
      </header>
      <main className="stage">
        <GameCanvas />
        <ActionTools />
        <StoragePanel />
        <TownHallPanel />
        <TeleporterPanel />
        {marketOpen && <MarketPanel onClose={() => setMarketOpen(false)} />}
        {bountiesOpen && <BountyBoard onClose={() => setBountiesOpen(false)} />}
        {recipeOpen && <RecipeBook onClose={() => setRecipeOpen(false)} />}
        {saveOpen && <SaveMenu onClose={() => setSaveOpen(false)} />}
        <AwaySummary />
        <Onboarding />
        {adminOpen && <AdminScreen onClose={() => (window.location.hash = '')} />}
      </main>
      <Palette />
    </div>
  )
}
