import { Emoji } from './components/Emoji'
import { GameCanvas } from './components/GameCanvas'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="hud">
        <span className="hud__title">
          <Emoji emoji="🏭" size={22} label="factory" /> Idle Factory
        </span>
        <span className="hud__hint">Drag to pan the world</span>
      </header>
      <main className="stage">
        <GameCanvas />
      </main>
    </div>
  )
}
