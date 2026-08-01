import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGameStore } from './store/gameStore'
import { achievementById } from './game/achievements'
import { createHostBridgeProvider, registerAchievementProvider } from './game/achievementProviders'
import './index.css'

// Dev-only: expose the store for debugging and automated verification. Stripped
// from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  ;(window as unknown as { idleFactory?: unknown }).idleFactory = useGameStore
}

// Wire up external achievement mirroring. The host-bridge provider forwards
// unlocks to a native shell (Steam/desktop) if one injected `window.gameAchievements`,
// and is a harmless no-op on the plain web — so registering it is always safe.
// It is seeded with whatever the loaded save already had unlocked, so a platform
// can reconcile its state on boot. Adding another service later (console, mobile,
// analytics) is just another registerAchievementProvider call here.
{
  const alreadyUnlocked = useGameStore
    .getState()
    .unlockedAchievements.map((u) => achievementById(u.id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined)
  registerAchievementProvider(createHostBridgeProvider('steam'), alreadyUnlocked)
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
