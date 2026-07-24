import { useEffect, useRef, useState } from 'react'
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
  // Only one HUD panel is open at a time — opening one closes any other.
  const [activePanel, setActivePanel] = useState<'market' | 'bounties' | 'recipe' | 'saves' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const adminOpen = useHash() === '#admin'

  // Close the HUD menu on an outside tap or Escape (only while it's open).
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // Each menu entry opens its panel (closing whichever was open), or closes it
  // if it's already the active one.
  const menuItems: { label: string; emoji: string; id: 'market' | 'bounties' | 'recipe' | 'saves' }[] = [
    { label: 'Market', emoji: '📈', id: 'market' },
    { label: 'Daily Challenges', emoji: '📋', id: 'bounties' },
    { label: 'Recipe Book', emoji: '📖', id: 'recipe' },
    { label: 'Saves', emoji: '💾', id: 'saves' },
  ]

  return (
    <div className="app">
      <header className="hud">
        <div className="hud__brand">
          <span className="hud__title">
            <Emoji emoji="🏭" size={22} label="factory" /> Auto-Exportica
          </span>
          <span className="hud__hint">Pick a tool, then tap a cell</span>
        </div>
        <div className="hud__right">
          <div className="hud__menu" ref={menuRef}>
            <button
              type="button"
              className={`hud__btn${menuOpen || activePanel !== null ? ' is-active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu"
              title="Menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="hud__menu-icon" aria-hidden="true">
                ☰
              </span>
            </button>
            {menuOpen && (
              <div className="hud__dropdown" role="menu">
                {menuItems.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={activePanel === m.id}
                    className={`hud__dropdown-item${activePanel === m.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setActivePanel((cur) => (cur === m.id ? null : m.id))
                      setMenuOpen(false)
                    }}
                  >
                    <Emoji emoji={m.emoji} size={18} label="" />
                    <span className="hud__dropdown-label">{m.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
        {activePanel === 'market' && <MarketPanel onClose={() => setActivePanel(null)} />}
        {activePanel === 'bounties' && <BountyBoard onClose={() => setActivePanel(null)} />}
        {activePanel === 'recipe' && <RecipeBook onClose={() => setActivePanel(null)} />}
        {activePanel === 'saves' && <SaveMenu onClose={() => setActivePanel(null)} />}
        <AwaySummary />
        <Onboarding />
        {adminOpen && <AdminScreen onClose={() => (window.location.hash = '')} />}
      </main>
      <Palette />
    </div>
  )
}
