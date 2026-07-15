import { PRESET_PROFILES, simulate, type SimResult } from '../src/game/simulator'
import { formatShort } from '../src/lib/format'
import { config } from '../src/data/config'

// Runnable balancing report. Simulates every preset profile over a month and
// prints a comparison of how quickly each reaches the end-game spawners, plus
// the head-to-head payoff of pouring money into villager buffs.
//
//   npm run simulate            # default 30 days
//   npm run simulate -- 60      # 60 days
//   npm run simulate -- 30 json # machine-readable JSON (for the dashboard)

const days = Number(process.argv[2]) || 30
const asJson = process.argv[3] === 'json'

const results = PRESET_PROFILES.map((p) => simulate(p, { days }))

if (asJson) {
  console.log(JSON.stringify({ days, config: { townLevers: config.townLevers }, results }, null, 2))
  process.exit(0)
}

const day = (d: number | null) => (d == null ? '  —  ' : `${d.toFixed(1)}d`.padStart(6))
const pad = (s: string, n: number) => s.padEnd(n)
const padL = (s: string, n: number) => s.padStart(n)

console.log(`\nAuto-Exportica — gameplay-loop simulation (${days} days)\n`)
console.log('Idealised auto-seller economy: mean prices, ROI-greedy building, town-hall buffs')
console.log('fed back into sell price / build cost / offline earnings. Relative, not literal.\n')

// The end-game spawners, priciest first.
const spawnerOrder = [...new Set(results.flatMap((r) => r.spawnerMilestones.map((m) => m.catalogId)))]
const spawnerCost: Record<string, { name: string; cost: number }> = {}
for (const r of results) for (const m of r.spawnerMilestones) spawnerCost[m.catalogId] = { name: m.name, cost: m.cost }
spawnerOrder.sort((a, b) => (spawnerCost[b]?.cost ?? 0) - (spawnerCost[a]?.cost ?? 0))
const topSpawners = spawnerOrder.slice(0, 6)

// --- Summary table -----------------------------------------------------------
console.log('PROFILE               END-GAME   NET WORTH   INCOME/tick   SELL×   SELL/BUFF')
console.log('─'.repeat(78))
for (const r of results) {
  console.log(
    pad(r.profile.name, 20) +
      '  ' +
      day(r.endGameDay) +
      '   ' +
      padL(formatShort(r.finalNetWorth), 9) +
      '   ' +
      padL(formatShort(r.finalIncomePerTick), 11) +
      '   ' +
      padL(r.finalModifiers.sellMultiplier.toFixed(2) + '×', 5) +
      '   ' +
      padL(`${r.sellLinesBuilt}/${r.buffLinesBuilt}`, 9),
  )
}

// --- Spawner unlock timeline (days to first build) ---------------------------
console.log('\nDays to first build each end-game spawner (— = never in window):\n')
const header = pad('PROFILE', 20) + topSpawners.map((s) => padL(shortName(spawnerCost[s]?.name ?? s), 9)).join('')
console.log(header)
console.log(pad('', 20) + topSpawners.map((s) => padL('$' + (spawnerCost[s]?.cost ?? 0), 9)).join(''))
console.log('─'.repeat(header.length))
for (const r of results) {
  const byId = new Map(r.spawnerMilestones.map((m) => [m.catalogId, m]))
  const cells = topSpawners.map((s) => {
    const m = byId.get(s)
    return padL(m ? m.atDay.toFixed(1) + 'd' : '—', 9)
  })
  console.log(pad(r.profile.name, 20) + cells.join(''))
}

// --- Buff payoff (seller vs buffs, same cadence) -----------------------------
console.log('\nBuff payoff — same cadence, buffs vs no buffs:\n')
const byName = new Map(results.map((r) => [r.profile.name, r]))
for (const cadence of ['Casual', 'Regular', 'Hardcore', 'Lapsed']) {
  const seller = byName.get(`${cadence} · seller`)
  const buffs = byName.get(`${cadence} · buffs`)
  if (!seller || !buffs) continue
  const nwDelta = pct(buffs.finalNetWorth, seller.finalNetWorth)
  const egDelta =
    seller.endGameDay != null && buffs.endGameDay != null
      ? `${(buffs.endGameDay - seller.endGameDay >= 0 ? '+' : '')}${(buffs.endGameDay - seller.endGameDay).toFixed(1)}d`
      : 'n/a'
  console.log(
    pad(cadence, 10) +
      `end-game ${egDelta.padStart(7)}   net worth ${nwDelta.padStart(8)}   ` +
      `(seller ${formatShort(seller.finalNetWorth)} vs buffs ${formatShort(buffs.finalNetWorth)})`,
  )
}

// --- Buff levels reached -----------------------------------------------------
console.log('\nBanked villagers & modifiers at end of run (buff profiles):\n')
for (const r of results) {
  if (r.profile.buffInvestmentFraction <= 0) continue
  const banked = Object.entries(r.bankedVillagers)
    .map(([t, n]) => `${t} ${Math.floor(n)}`)
    .join(', ')
  const m = r.finalModifiers
  console.log(
    pad(r.profile.name, 20) +
      `sell ${m.sellMultiplier.toFixed(2)}× · build ${m.buildCostMultiplier.toFixed(2)}× · offline ${m.offlineMultiplier.toFixed(2)}×`,
  )
  console.log(pad('', 20) + (banked || '(none banked)'))
}
console.log()

function pct(a: number, b: number): string {
  if (b <= 0) return 'n/a'
  const p = (a / b - 1) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(0)}%`
}

function shortName(name: string): string {
  return name.replace(' Deposit', '').replace(' Mine', '').replace(' Field', '').slice(0, 8)
}
