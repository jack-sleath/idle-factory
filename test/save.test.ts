import { describe, it, expect, beforeEach } from 'vitest'
import { makeSave, parseSave, loadSave, writeSave, SAVE_KEY } from '../src/game/save'
import { config } from '../src/data/config'
import type { Machine } from '../src/game/types'

const machines: Machine[] = [
  { id: 'a', kind: 'spawner', catalogId: 'ore-gatherer-basic', x: 0, y: 0, dir: 'E' },
  { id: 'b', kind: 'belt', catalogId: 'belt-basic', x: 1, y: 0, dir: 'S' },
]
const camera = { x: 3, y: -2, zoom: 90 }

describe('save schema', () => {
  beforeEach(() => localStorage.clear())

  it('makeSave stamps the configured version', () => {
    const save = makeSave(camera, machines, 12345)
    expect(save.version).toBe(config.saveVersion)
    expect(save.savedAt).toBe(12345)
    expect(save.machines).toHaveLength(2)
  })

  it('parseSave round-trips a serialized save', () => {
    const save = makeSave(camera, machines, 999)
    const parsed = parseSave(JSON.stringify(save))
    expect(parsed).not.toBeNull()
    expect(parsed!.camera).toEqual(camera)
    expect(parsed!.machines).toEqual(machines)
  })

  it('round-trips money and storage contents (v2)', () => {
    const stores = [{ key: '2,0', item: 'ore', count: 42 }]
    const save = makeSave(camera, machines, 1, 1234.5, stores)
    expect(save.version).toBe(2)
    const parsed = parseSave(JSON.stringify(save))!
    expect(parsed.money).toBe(1234.5)
    expect(parsed.stores).toEqual(stores)
  })

  it('loads a legacy v1 save (no money/stores) with defaults', () => {
    const legacy = { version: 1, savedAt: 5, camera, machines }
    const parsed = parseSave(JSON.stringify(legacy))!
    expect(parsed).not.toBeNull()
    expect(parsed.money).toBe(0)
    expect(parsed.stores).toEqual([])
  })

  it('parseSave rejects malformed input', () => {
    expect(parseSave('not json')).toBeNull()
    expect(parseSave('42')).toBeNull()
    expect(parseSave('{}')).toBeNull() // missing machines/camera
    expect(parseSave(JSON.stringify({ version: 1, machines: [] }))).toBeNull() // no camera
  })

  it('writeSave + loadSave round-trip through localStorage', () => {
    writeSave(makeSave(camera, machines, 500))
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
    const loaded = loadSave()
    expect(loaded!.machines).toEqual(machines)
    expect(loaded!.camera).toEqual(camera)
  })
})
