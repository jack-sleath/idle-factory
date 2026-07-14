import { describe, it, expect } from 'vitest'
import { validateData } from '../src/data/validate'
import { combinerOutput, processorOutput } from '../src/data'

describe('game data integrity', () => {
  it('has no broken item references in catalog or recipes', () => {
    // If this fails, the message lists exactly which id is unknown or malformed.
    expect(validateData()).toEqual([])
  })
})

describe('pie production chain', () => {
  it('turns water + wheat into dough, then dough into a pie case', () => {
    expect(combinerOutput('water', 'wheat')).toBe('dough')
    expect(combinerOutput('wheat', 'water')).toBe('dough') // order-independent
    expect(processorOutput('dough')).toBe('pie-case')
  })

  it('combines a pie case with a fruit/veg into the matching pie', () => {
    expect(combinerOutput('pie-case', 'apple')).toBe('apple-pie')
    expect(combinerOutput('pie-case', 'pumpkin')).toBe('pumpkin-pie')
    expect(combinerOutput('pie-case', 'strawberry')).toBe('strawberry-pie')
  })

  it('sweetens a pie case with sugar, then bakes premium sweet pies', () => {
    expect(combinerOutput('pie-case', 'sugar')).toBe('sweet-pie-case')
    expect(combinerOutput('sweet-pie-case', 'apple')).toBe('sweet-apple-pie')
    expect(combinerOutput('sweet-pie-case', 'pumpkin')).toBe('sweet-pumpkin-pie')
    expect(combinerOutput('sweet-pie-case', 'strawberry')).toBe('sweet-strawberry-pie')
  })
})

describe('drinks', () => {
  it('combines water with a fruit/veg or sugar into the matching drink', () => {
    expect(combinerOutput('water', 'sugar')).toBe('lemonade')
    expect(combinerOutput('water', 'apple')).toBe('apple-juice')
    expect(combinerOutput('water', 'grapes')).toBe('grape-juice')
    expect(combinerOutput('water', 'carrot')).toBe('carrot-juice')
    expect(combinerOutput('water', 'strawberry')).toBe('smoothie')
  })
})
