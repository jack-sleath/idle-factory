import { CATALOG, CATALOG_BY_ID, ITEMS, ITEMS_BY_ID, RECIPES } from '../data'
import { config } from '../data/config'

// "Flavour A" analytical progression model (milestone-power-scaling). It answers
// "how long until every item is being auto-sold?" from a fresh start, cheaply
// enough to recompute live while tuning. It is idealised on purpose: no grid or
// belt geometry, fixed base prices, and one self-contained production+sell line
// per item type. The number is only meaningful relative to the build policy
// below (ROI-greedy), which is exactly what makes it useful for comparing tuning
// changes rather than predicting real play.

/** In-memory overrides so an admin screen can tune values without touching JSON. */
export interface ScalingOverrides {
  /** item id -> sale price */
  price?: Record<string, number>
  /** catalog id -> build cost */
  cost?: Record<string, number>
  /** spawner catalog id -> ticks between emissions */
  rateTicks?: Record<string, number>
}

export interface TimelineEntry {
  item: string
  atTick: number
  atMs: number
  lineCost: number
  incomePerTick: number
}

export interface ScalingReport {
  targetCount: number
  bootstrapIncomePerTick: number
  totalBuildCost: number
  fullIncomePerTick: number
  timeToFullTicks: number
  timeToFullMs: number
  timeline: TimelineEntry[]
}

// The free basic chain (ore gatherer -> belt -> storage) plus manual Sell-All is
// modelled as ore auto-selling from t=0, funding the first purchases.
const BOOTSTRAP_ITEM = 'ore'

/** Compute the progression report for the current economy, with optional overrides. */
export function scalingReport(ov: ScalingOverrides = {}): ScalingReport {
  const price = (id: string): number => ov.price?.[id] ?? ITEMS_BY_ID[id]?.startingValue ?? 0
  const machineCost = (catalogId: string): number => ov.cost?.[catalogId] ?? CATALOG_BY_ID[catalogId]?.cost ?? 0
  const PROC = machineCost('processor-basic')
  const COMB = machineCost('combiner-basic')
  const SELLER = machineCost('seller-basic')
  const BELT = machineCost('belt-basic')

  const spawnerFor = new Map<string, { catalogId: string; rateTicks: number; cost: number }>()
  for (const c of CATALOG) {
    if (c.kind === 'spawner' && c.outputItem && c.rateTicks) {
      spawnerFor.set(c.outputItem, {
        catalogId: c.id,
        rateTicks: ov.rateTicks?.[c.id] ?? c.rateTicks,
        cost: machineCost(c.id),
      })
    }
  }
  const procByOut = new Map(RECIPES.processor.map((r) => [r.out, r.in]))
  const combByOut = new Map(RECIPES.combiner.map((r) => [r.out, [r.a, r.b] as const]))

  // Items produced per tick for `item`, gated by the slowest spawner in its tree
  // (a combiner is gated by the slower of its two feeds).
  const rateMemo = new Map<string, number>()
  const rate = (item: string, seen = new Set<string>()): number => {
    const cached = rateMemo.get(item)
    if (cached !== undefined) return cached
    if (seen.has(item)) return 0 // cycle guard (recipes are acyclic, but be safe)
    seen.add(item)
    let r = 0
    const sp = spawnerFor.get(item)
    if (sp) r = sp.rateTicks > 0 ? 1 / sp.rateTicks : 0
    else if (procByOut.has(item)) r = rate(procByOut.get(item)!, seen)
    else {
      const c = combByOut.get(item)
      if (c) r = Math.min(rate(c[0], seen), rate(c[1], seen))
    }
    rateMemo.set(item, r)
    return r
  }

  // Machines (deduped) to produce `item` from raw, keyed so a shared sub-step in
  // one line is counted once. Excludes the seller (added in lineCost).
  const collect = (item: string, acc: Map<string, number>, seen = new Set<string>()): void => {
    if (seen.has(item)) return
    seen.add(item)
    const sp = spawnerFor.get(item)
    if (sp) {
      acc.set('sp:' + sp.catalogId, sp.cost)
      return
    }
    if (procByOut.has(item)) {
      acc.set('proc:' + item, PROC)
      collect(procByOut.get(item)!, acc, seen)
      return
    }
    const c = combByOut.get(item)
    if (c) {
      acc.set('comb:' + item, COMB)
      collect(c[0], acc, seen)
      collect(c[1], acc, seen)
    }
  }

  const lineCost = (item: string): number => {
    const acc = new Map<string, number>()
    collect(item, acc)
    const machines = [...acc.values()].reduce((sum, v) => sum + v, 0)
    return machines + acc.size * BELT + SELLER // ~one belt per producer machine
  }

  const hasProducer = (id: string) => spawnerFor.has(id) || procByOut.has(id) || combByOut.has(id)

  const targets = ITEMS.filter(
    (it) => it.id !== 'junk' && it.id !== BOOTSTRAP_ITEM && hasProducer(it.id),
  )
    .map((it) => ({ item: it.id, lineCost: lineCost(it.id), incomePerTick: rate(it.id) * price(it.id) }))
    .filter((t) => t.incomePerTick > 0)

  const bootstrapIncomePerTick = rate(BOOTSTRAP_ITEM) * price(BOOTSTRAP_ITEM)

  // ROI-greedy: build the best income-per-cost line first, fast-forwarding ticks
  // to afford each. Income accrues continuously and grows as lines come online.
  const ordered = [...targets].sort((a, b) => b.incomePerTick / b.lineCost - a.incomePerTick / a.lineCost)
  let tick = 0
  let money = 0
  let income = bootstrapIncomePerTick
  const timeline: TimelineEntry[] = []
  for (const t of ordered) {
    if (income <= 0) break
    if (money < t.lineCost) {
      const dt = Math.ceil((t.lineCost - money) / income)
      tick += dt
      money += dt * income
    }
    money -= t.lineCost
    income += t.incomePerTick
    timeline.push({
      item: t.item,
      atTick: tick,
      atMs: tick * config.tickMs,
      lineCost: t.lineCost,
      incomePerTick: t.incomePerTick,
    })
  }

  return {
    targetCount: targets.length,
    bootstrapIncomePerTick,
    totalBuildCost: targets.reduce((sum, t) => sum + t.lineCost, 0),
    fullIncomePerTick: income,
    timeToFullTicks: tick,
    timeToFullMs: tick * config.tickMs,
    timeline,
  }
}
