import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { config } from '../data/config'

/**
 * Drives live play: advances the simulation by one tick every `tickMs`. The
 * step is decoupled from rendering (the canvas draws in its own rAF loop and
 * simply reads the latest item positions each frame).
 */
export function useGameLoop() {
  useEffect(() => {
    const id = setInterval(() => {
      useGameStore.getState().advanceTick()
    }, config.tickMs)
    return () => clearInterval(id)
  }, [])
}
