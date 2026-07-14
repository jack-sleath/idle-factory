import { describe, it, expect } from 'vitest'
import { validateData } from '../src/data/validate'

describe('game data integrity', () => {
  it('has no broken item references in catalog or recipes', () => {
    // If this fails, the message lists exactly which id is unknown or malformed.
    expect(validateData()).toEqual([])
  })
})
