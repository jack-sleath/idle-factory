import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

// How often to check whether a market interval has elapsed. The market only
// actually moves every `marketIntervalMinutes`; this poll just keeps the check
// responsive (and robust to background-tab throttling) without a per-interval
// timer that could drift.
const MARKET_POLL_MS = 5000

/** Drives the stock market: periodically applies any elapsed market intervals. */
export function useMarketLoop() {
  useEffect(() => {
    const tick = () => useGameStore.getState().advanceMarket()
    tick() // catch up immediately on mount
    const id = setInterval(tick, MARKET_POLL_MS)
    return () => clearInterval(id)
  }, [])
}
