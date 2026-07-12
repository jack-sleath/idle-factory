import { config } from '../data/config'

// Cookie-Clicker-style large-number formatting. Small values stay readable
// (whole ones, a little precision for fractions); large values collapse onto a
// short-scale suffix (K, M, B, T, …) with three significant figures.

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

/**
 * Abbreviate a number for display. Examples: 42 → "42", 1234 → "1.23K",
 * 5_000_000 → "5M", 1.5e9 → "1.5B". Negatives keep their sign; values beyond
 * the suffix table fall back to exponential notation.
 */
export function formatShort(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n < 0) return '-' + formatShort(-n)
  if (n < 1000) return trimNumber(n)

  let tier = Math.floor(Math.log10(n) / 3)
  let scaled = n / 1000 ** tier
  // A value like 999_999 scales to 999.999, which rounds up to "1000" — roll it
  // into the next suffix so we show "1M", not "1000K".
  if (scaled >= 999.5 && tier + 1 < SUFFIXES.length) {
    tier += 1
    scaled = n / 1000 ** tier
  }
  if (tier >= SUFFIXES.length) return n.toExponential(2)
  return trim3sig(scaled) + SUFFIXES[tier]
}

/** Money display: a coin-free plain number, abbreviated (Cookie-Clicker style). */
export function formatMoney(n: number): string {
  return config.numberFormat === 'short' ? formatShort(n) : trimNumber(n)
}

/** A short human duration, e.g. "2h 15m", "5m 3s", "42s". */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Sub-1000 values: whole numbers as-is, fractions to at most two decimals. */
function trimNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}

/** Three significant figures for a scaled 1..999 value, without trailing zeros. */
function trim3sig(n: number): string {
  const decimals = n >= 100 ? 0 : n >= 10 ? 1 : 2
  return String(Math.round(n * 10 ** decimals) / 10 ** decimals)
}
