import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGameStore } from './store/gameStore'
import './index.css'

// Dev-only: expose the store for debugging and automated verification. Stripped
// from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  ;(window as unknown as { idleFactory?: unknown }).idleFactory = useGameStore
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
