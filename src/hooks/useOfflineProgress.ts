import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

/**
 * Offline idle progression (M9): catch up stockpiles, seller earnings, and the
 * market for time spent away. Runs once on mount (covers a full reload / reopen)
 * and whenever the tab becomes visible again. The matching "→ hidden" persist
 * (which stamps `savedAt`) is handled by useAutosaveOnHide in App.
 */
export function useOfflineProgress() {
  useEffect(() => {
    useGameStore.getState().applyOfflineProgress()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') useGameStore.getState().applyOfflineProgress()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
}
