import { describe, it, expect } from 'vitest'
import { scalingReport } from '../src/game/scaling'
import { ITEMS } from '../src/data'

describe('scaling model', () => {
  it('reports a positive time-to-full covering every target, in build order', () => {
    const r = scalingReport()
    expect(r.targetCount).toBeGreaterThan(0)
    expect(r.timeline).toHaveLength(r.targetCount)
    expect(r.timeToFullTicks).toBeGreaterThan(0)
    expect(r.timeToFullMs).toBe(r.timeToFullTicks * 500)
    // full income exceeds the bootstrap (every built line adds income)
    expect(r.fullIncomePerTick).toBeGreaterThan(r.bootstrapIncomePerTick)
    // the timeline is monotonic in time
    for (let i = 1; i < r.timeline.length; i++) {
      expect(r.timeline[i].atTick).toBeGreaterThanOrEqual(r.timeline[i - 1].atTick)
    }
  })

  it('higher prices reach full automation sooner', () => {
    const base = scalingReport()
    const doubled = Object.fromEntries(ITEMS.map((it) => [it.id, it.startingValue * 2]))
    const richer = scalingReport({ price: doubled })
    expect(richer.timeToFullTicks).toBeLessThan(base.timeToFullTicks)
  })

  it('cheaper machines reach full automation no later', () => {
    const base = scalingReport()
    const cheaper = scalingReport({
      cost: { 'processor-basic': 1, 'combiner-basic': 1, 'seller-basic': 1 },
    })
    expect(cheaper.timeToFullTicks).toBeLessThanOrEqual(base.timeToFullTicks)
  })

  it('faster spawners reach full automation sooner', () => {
    const base = scalingReport()
    // Halve every spawner's tick interval (twice the throughput).
    const rateTicks: Record<string, number> = {}
    for (const id of ['ore-gatherer-basic', 'silver-mine', 'gold-mine', 'sapphire-deposit', 'emerald-deposit', 'ruby-deposit', 'diamond-deposit', 'cow']) {
      rateTicks[id] = 1
    }
    const faster = scalingReport({ rateTicks })
    expect(faster.timeToFullTicks).toBeLessThan(base.timeToFullTicks)
  })
})
