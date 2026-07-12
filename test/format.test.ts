import { describe, it, expect } from 'vitest'
import { formatDuration, formatShort } from '../src/lib/format'

describe('formatShort (Cookie-Clicker abbreviation)', () => {
  it('leaves sub-thousand values readable', () => {
    expect(formatShort(0)).toBe('0')
    expect(formatShort(42)).toBe('42')
    expect(formatShort(999)).toBe('999')
    expect(formatShort(3.5)).toBe('3.5')
  })

  it('abbreviates onto the short scale (K/M/B) with three significant figures', () => {
    expect(formatShort(1000)).toBe('1K')
    expect(formatShort(1234)).toBe('1.23K')
    expect(formatShort(12_345)).toBe('12.3K')
    expect(formatShort(1_000_000)).toBe('1M')
    expect(formatShort(1_500_000_000)).toBe('1.5B')
  })

  it('rolls a value that rounds up to 1000 into the next suffix', () => {
    expect(formatShort(999_999)).toBe('1M')
    expect(formatShort(999_499)).toBe('999K') // stays below the roll-over
  })

  it('keeps the sign for negative values', () => {
    expect(formatShort(-2500)).toBe('-2.5K')
  })
})

describe('formatDuration', () => {
  it('formats hours/minutes/seconds compactly', () => {
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(5 * 60_000 + 3_000)).toBe('5m 3s')
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m')
    expect(formatDuration(0)).toBe('0s')
  })
})
