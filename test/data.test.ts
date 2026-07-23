import { describe, it, expect } from 'vitest'
import { validateData } from '../src/data/validate'
import { CATALOG_BY_ID, combinerOutput, ITEMS, ITEMS_BY_ID, processorOutput } from '../src/data'
import { ITEM_CATEGORIES } from '../src/game/types'

describe('game data integrity', () => {
  it('has no broken item references in catalog or recipes', () => {
    // If this fails, the message lists exactly which id is unknown or malformed.
    expect(validateData()).toEqual([])
  })
})

describe('item categories', () => {
  it('gives every item a known category', () => {
    const known = new Set<string>(ITEM_CATEGORIES)
    for (const item of ITEMS) expect(known.has(item.category)).toBe(true)
  })

  it('categorizes by role: in-betweens are material, raw food/treasure keep identity', () => {
    const c = (id: string) => ITEMS_BY_ID[id].category
    // Non-edible-until-processed crops and intermediates are material…
    expect(c('wheat')).toBe('material')
    expect(c('sugarcane')).toBe('material')
    expect(c('ore')).toBe('material')
    expect(c('gold-bar')).toBe('material')
    expect(c('dough')).toBe('material')
    expect(c('pie-case')).toBe('material')
    // …while raw items that are food/treasure in their own right keep identity.
    expect(c('apple')).toBe('food')
    expect(c('diamond')).toBe('valuable')
    expect(c('gold-diamond-amulet')).toBe('valuable')
    expect(c('water')).toBe('drink')
    expect(c('diamond-sword')).toBe('weapon')
    expect(c('bed')).toBe('misc')
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
  it('combines water with a fruit/veg into the matching drink', () => {
    expect(combinerOutput('lemon-juice', 'sugar')).toBe('lemonade')
    expect(combinerOutput('water', 'apple')).toBe('apple-juice')
    expect(combinerOutput('water', 'grapes')).toBe('grape-juice')
    expect(combinerOutput('water', 'carrot')).toBe('carrot-juice')
    expect(combinerOutput('water', 'strawberry')).toBe('smoothie')
  })
})

describe('chicken / lemon / beehive chains', () => {
  it('spawns egg, lemon and honey from their farm-track spawners', () => {
    expect(CATALOG_BY_ID['chicken'].outputItem).toBe('egg')
    expect(CATALOG_BY_ID['lemon-tree'].outputItem).toBe('lemon')
    expect(CATALOG_BY_ID['beehive'].outputItem).toBe('honey')
  })

  it('cooks egg dishes, incl. cake from the cross-chain egg + honey', () => {
    expect(combinerOutput('egg', 'wheat')).toBe('pancakes')
    expect(combinerOutput('egg', 'cheese')).toBe('omelette')
    expect(combinerOutput('egg', 'sugar')).toBe('custard')
    expect(combinerOutput('honey', 'egg')).toBe('cake') // order-independent
  })

  it('turns lemon and honey into their drinks/preserves', () => {
    expect(combinerOutput('water', 'lemon')).toBe('lemon-juice')
    expect(combinerOutput('lemon', 'sugar')).toBe('marmalade')
    expect(combinerOutput('water', 'honey')).toBe('mead')
  })
})
