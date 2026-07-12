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

  const tier = Math.floor(Math.log10(n) / 3)
  if (tier >= SUFFIXES.length) return n.toExponential(2)

  const scaled = n / 1000 ** tier
  return trim3sig(scaled) + SUFFIXES[tier]
}

/** Money display: a coin-free plain number, abbreviated (Cookie-Clicker style). */
export function formatMoney(n: number): string {
  return config.numberFormat === 'short' ? formatShort(n) : trimNumber(n)
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
