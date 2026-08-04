import fs from 'node:fs'
import path from 'node:path'
import { CATALOG, ITEMS, ITEMS_BY_ID, RECIPES } from '../src/data'
import { config } from '../src/data/config'

// The spawner tier ladder — the source of truth for how the economy is priced.
//
//   npm run ladder            # print the ladder + what it would change
//   npm run ladder -- write   # write it into items.json + catalog.json
//
// CC's shape (per the wiki): ~20 building tiers, each ~×10 the cost of the tier
// below for ~×6 the output, so PAYBACK TIME roughly doubles per tier — the newest
// building is always a goal rather than an efficiency play — with a uniform ×1.15
// per-copy price growth (already what this repo uses).
//
// Ported here: every spawner belongs to a TIER. Each tier's raw items get a
// hand-picked value (flavour: a lemon is worth less than a diamond), and each
// spawner's cost is then DERIVED as `payback_target(tier) × that line's income`.
// Two properties follow, and they are the point of this file:
//
//   • Within a tier every spawner earns the same return per coin, so there is no
//     single "best" farm to spam (the old $48k beehive out-earned every other
//     farm line by 3×).
//   • Across tiers payback gets steadily worse, so a higher tier is a GOAL rather
//     than an efficiency play — exactly how Cookie Clicker's ladder reads.
//
// Processed items keep their hand-authored value unless their inputs have outgrown
// it, in which case they are lifted to input-sum × margin so no chain is a loss.
// Re-run with `write` after changing any knob below, then `npm run simulate` to
// see what it did to the pacing.

const TIERS: string[][] = [
  ['ore-gatherer-basic', 'well', 'oak-tree'],
  ['wheat-field', 'corn-field', 'potato-farm', 'carrot-patch', 'tomato-plant', 'sugarcane-field'],
  ['grape-vine', 'apple-orchard', 'strawberry-patch', 'lemon-tree', 'chicken', 'cow', 'sheep'],
  ['pumpkin-patch', 'beehive'],
  ['silver-mine', 'gold-mine'],
  ['sapphire-deposit', 'emerald-deposit'],
  ['ruby-deposit', 'diamond-deposit'],
]

// Knobs. Values come first (a flavour ladder over the raw items), then each
// spawner's cost is DERIVED as `payback_target(tier) × its line's income`. That
// makes every spawner in a tier earn the same return per coin (no more $48k
// beehives out-earning everything) while payback worsens up the ladder, which is
// the Cookie Clicker property we're after.
//
// Payback targets in ticks. T1–T3 are deliberately quick and cheap — with a $1
// minimum item value, a cheap spawner CANNOT be slow to pay back, so accessible
// farming necessarily means a brisk first day. The discipline lives from T4 up,
// anchored at roughly today's farm payback (~80k ticks) and worsening ~×1.7 per
// tier, so the deposit track is a genuine climb rather than a two-day formality.
const PAYBACK_TICKS = [12_000, 20_000, 36_000, 200_000, 550_000, 1_400_000, 2_700_000]
const RAW_VALUE: Record<string, number> = {
  ore: 1, water: 1, log: 1,
  corn: 2, potato: 2, carrot: 2, tomato: 3, wheat: 3, sugarcane: 3,
  egg: 5, wool: 6, milk: 6, grapes: 6, lemon: 6, apple: 7, strawberry: 8,
  honey: 15, pumpkin: 20,
  'silver-ore': 30, 'gold-ore': 40,
  sapphire: 110, emerald: 130,
  ruby: 320, diamond: 450,
}
const MARGIN = 1.3 // minimum value uplift per processing step

/** The village hut and town hall are goals, not producers: priced by hand. */
const HUT_COST = 200_000
const HALL_COST = 1_000_000

const round = (v: number): number => {
  if (v < 10) return Math.max(1, Math.round(v))
  if (v < 100) return Math.round(v / 5) * 5
  if (v < 1000) return Math.round(v / 10) * 10
  return Math.round(v / 50) * 50
}

const tierOf = new Map<string, number>()
TIERS.forEach((ids, i) => ids.forEach((id) => tierOf.set(id, i)))
const spawners = CATALOG.filter((c) => c.kind === 'spawner')
for (const s of spawners) if (!tierOf.has(s.id)) throw new Error(`spawner ${s.id} has no tier`)

// --- Spawner costs + raw item values ---------------------------------------
const newCost = new Map<string, number>()
const newValue = new Map<string, number>()
for (const s of spawners) {
  const tier = tierOf.get(s.id)!
  const item = s.outputItem!
  const value = RAW_VALUE[item]
  if (value === undefined) throw new Error(`no raw value for ${item}`)
  newValue.set(item, value)
  const income = value / (s.rateTicks ?? 5)
  newCost.set(s.id, Math.round((PAYBACK_TICKS[tier] * income) / 1000) * 1000)
}

// --- Processed items: keep the authored value unless inputs outgrew it -------
const procIn = new Map(RECIPES.processor.map((r) => [r.out, [r.in] as string[]]))
const combIn = new Map(RECIPES.combiner.map((r) => [r.out, [r.a, r.b] as string[]]))
const valueOf = (id: string, seen = new Set<string>()): number => {
  if (newValue.has(id)) return newValue.get(id)!
  if (seen.has(id)) return ITEMS_BY_ID[id]?.startingValue ?? 1
  seen.add(id)
  const inputs = procIn.get(id) ?? combIn.get(id)
  const authored = ITEMS_BY_ID[id]?.startingValue ?? 1
  if (!inputs) {
    newValue.set(id, authored)
    return authored
  }
  const inputSum = inputs.reduce((s, i) => s + valueOf(i, seen), 0)
  // Only ever lift: an authored value is kept exactly unless its inputs have
  // outgrown it, so rounding can never quietly shave a hand-picked price down.
  const v = Math.max(authored, round(inputSum * MARGIN))
  newValue.set(id, v)
  return v
}
for (const it of ITEMS) if (it.category !== 'villager' && it.id !== config.junkItemId) valueOf(it.id)

// --- Report -----------------------------------------------------------------
console.log('\nTIER LADDER\n')
TIERS.forEach((ids, tier) => {
  const cost = newCost.get(ids[0])!
  const items = ids.map((id) => {
    const s = spawners.find((x) => x.id === id)!
    const v = newValue.get(s.outputItem!)!
    return `${s.outputItem} $${v}`
  })
  const s0 = spawners.find((x) => x.id === ids[0])!
  const income = newValue.get(s0.outputItem!)! / (s0.rateTicks ?? 5)
  console.log(
    `T${tier + 1}  spawner $${cost.toLocaleString().padStart(10)}   line income ${income.toFixed(2)}/tick   ` +
      `payback ${Math.round(cost / income / 1000)}k ticks (${(cost / income / 172_800).toFixed(1)}d)   ${items.join(', ')}`,
  )
})

console.log('\nITEM VALUE CHANGES (top 24 by ratio)\n')
const changes = ITEMS.filter((i) => newValue.has(i.id))
  .map((i) => ({ id: i.id, from: i.startingValue, to: newValue.get(i.id)!, r: newValue.get(i.id)! / i.startingValue }))
  .filter((c) => c.to !== c.from)
  .sort((a, b) => b.r - a.r)
for (const c of changes.slice(0, 24)) console.log(`  ${c.id.padEnd(22)} $${c.from} → $${c.to}  (×${c.r.toFixed(1)})`)
console.log(`  … ${changes.length} items changed of ${ITEMS.length}`)

// --- Write ------------------------------------------------------------------
if (process.argv[2] === 'write') {
  const dir = path.join(process.cwd(), 'src', 'data')

  // Patch the numbers in place rather than re-serializing: the data files are
  // hand-formatted one entry per line, and a JSON.stringify round-trip would
  // reformat all of it and bury the actual change in the diff.
  const patch = (file: string, wanted: Map<string, number>, field: string): number => {
    const full = path.join(dir, file)
    const lines = fs.readFileSync(full, 'utf8').split('\n')
    let changed = 0
    // Tracks which entry we are inside, so this works whether the file puts one
    // entry per line (items.json) or spreads each over several (catalog.json).
    let current: string | null = null
    const out = lines.map((line) => {
      const id = /"id":\s*"([^"]+)"/.exec(line)?.[1]
      if (id) current = id
      if (!current || !wanted.has(current)) return line
      const next = wanted.get(current)!
      const patched = line.replace(new RegExp(`("${field}":\\s*)(-?\\d+(?:\\.\\d+)?)`), `$1${next}`)
      if (patched !== line) changed++
      return patched
    })
    fs.writeFileSync(full, out.join('\n'))
    return changed
  }

  const costs = new Map(newCost)
  costs.set('village-hut', HUT_COST)
  costs.set('town-hall', HALL_COST)
  const nItems = patch('items.json', newValue, 'startingValue')
  const nCatalog = patch('catalog.json', costs, 'cost')
  console.log(`\nWrote ${nItems} item values and ${nCatalog} catalog costs.`)
}
