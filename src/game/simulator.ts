import { CATALOG, CATALOG_BY_ID, ITEMS, ITEMS_BY_ID, RECIPES } from '../data'
import { config } from '../data/config'
import { computeTownModifiers, type TownModifiers } from './town'
import type { TownHallState } from './tick'

// Gameplay-loop simulator (balancing tool).
//
// This is a *headless economic simulation*, in the same spirit as the analytical
// model in `scaling.ts`: it deliberately ignores grid/belt geometry and models
// the factory as a portfolio of self-contained, auto-selling production lines.
// What it adds on top of `scaling.ts` is the thing you can't answer analytically
// — the shape of real play over calendar time:
//
//   • Player PROFILES: how long a session is, how many sessions a day, how fast
//     a player can physically lay down new lines, and how much of their money
//     they pour into villager buffs.
//   • A TIME LOOP over ~a month, alternating active sessions (earn + build) with
//     offline gaps (earn at the offline rate, capped at `maxOfflineHours`), so we
//     can watch when each profile can first afford the expensive end-game
//     spawners (diamond deposit, ruby deposit, …).
//   • The town-hall BUFF economy (villagers banked → `computeTownModifiers`),
//     fed back into sell price / build cost / offline earnings, so a buff-maxing
//     player and a pure-seller can be compared head to head.
//
// Like `scaling.ts` the numbers are only meaningful *relative to each other* —
// this predicts tuning deltas ("did halving the diamond deposit cost pull its
// unlock forward?"), not literal wall-clock play. Prices are modelled at each
// item's mean (`startingValue`), because an auto-seller sells into a
// mean-reverting market at whatever the price happens to be; that is why the
// market-timing buffs (guard/farmer/miner, which only widen the price band)
// show ~no effect here and the compounding buffs (merchant/mason/innkeeper) do.

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE

// --- Tuning overrides (mirror scaling.ts so the same knobs can be swept) -----

export interface SimOverrides {
  /** item id -> sale price (defaults to the item's startingValue). */
  price?: Record<string, number>
  /** catalog id -> build cost (defaults to the catalog cost). */
  cost?: Record<string, number>
  /** spawner catalog id -> ticks between emissions (defaults to catalog). */
  rateTicks?: Record<string, number>
}

// --- Player profile ----------------------------------------------------------

export interface PlayerProfile {
  /** Display name, e.g. "Regular (buffs)". */
  name: string
  /** Minutes of active, hands-on play per session. */
  sessionMinutes: number
  /**
   * Sessions per day. May be fractional: 0.5 means one session every two days.
   * The gap between sessions is `24h / sessionsPerDay − sessionMinutes`, and the
   * factory earns at the offline rate across that gap (capped at maxOfflineHours).
   */
  sessionsPerDay: number
  /**
   * How many machines the player can physically place per active minute. Bounds
   * how much a session can expand the factory, so session *length* matters for
   * building, not just for the passive earn window — and a long villager chain
   * (many machines) eats far more of this budget than a short sell line.
   */
  machinesPerMinute: number
  /**
   * Fraction of the money on hand each session routed into the villager-buff
   * pipeline (town halls + villager→specialist lines) instead of sell lines.
   * 0 = pure seller; 0.5 = split evenly. The rest funds sell lines.
   */
  buffInvestmentFraction: number
  /**
   * Which villager specialists to bank, in priority order. Defaults to the buffs
   * that actually move the needle for an auto-seller economy
   * (merchant → sell price, innkeeper → offline, mason → build cost, plus raw
   * villagers). See the note at the top about why guard/farmer/miner are omitted.
   */
  buffPriority?: string[]
}

const DEFAULT_BUFF_PRIORITY = ['merchant', 'innkeeper', 'mason', 'villager']

// --- Production model ---------------------------------------------------------

interface LineDef {
  /** Output item id. */
  item: string
  /** Items produced per tick by one self-contained line (slowest-input gated). */
  ratePerTick: number
  /** Income per tick at the mean price (rate × price), before any buffs. */
  incomePerTick: number
  /** Build cost at buildCostMultiplier = 1 (machines + belts + terminal). */
  baseCost: number
  /**
   * How many machines make up one line (producers + belts + terminal). Consumed
   * from the per-session placement budget, so a long villager chain costs far
   * more of a player's hands-on time than a single spawner→seller line.
   */
  machineCount: number
  /** Spawner catalog ids this line contains (for end-game milestone tracking). */
  spawners: string[]
}

interface ProductionModel {
  /** Sellable lines (everything with a producer, minus junk and villagers). */
  sellLines: LineDef[]
  /** Villager-type lines, keyed by villager item id (terminal = town hall). */
  buffLines: Record<string, LineDef>
  /** Bootstrap: the free starter ore line, auto-sold from t=0. */
  bootstrap: LineDef
}

/** The catalog id of the (first) buildable of a given kind. */
function catalogIdOfKind(kind: string): string | null {
  return CATALOG.find((c) => c.kind === kind)?.id ?? null
}

/**
 * Build the production model for the current data, applying tuning overrides.
 * Rates and costs mirror `scaling.ts`, extended to understand the village recipe
 * (villager = hut(food + drink + bed)) so the whole buff chain is derivable.
 */
export function buildProductionModel(ov: SimOverrides = {}): ProductionModel {
  const price = (id: string) => ov.price?.[id] ?? ITEMS_BY_ID[id]?.startingValue ?? 0
  const cost = (cid: string) => ov.cost?.[cid] ?? CATALOG_BY_ID[cid]?.cost ?? 0

  const PROC = cost(catalogIdOfKind('processor') ?? '')
  const COMB = cost(catalogIdOfKind('combiner') ?? '')
  const SELLER = cost(catalogIdOfKind('seller') ?? '')
  const BELT = cost(catalogIdOfKind('belt') ?? '')
  const HUT = cost(catalogIdOfKind('village') ?? '')
  const HALL = cost(catalogIdOfKind('townhall') ?? '')

  // Item -> its cheapest spawner (there is one per raw item today, but pick the
  // cheapest defensively) with its (possibly overridden) rate.
  const spawnerFor = new Map<string, { catalogId: string; rateTicks: number }>()
  for (const c of CATALOG) {
    if (c.kind !== 'spawner' || !c.outputItem || !c.rateTicks) continue
    const rateTicks = ov.rateTicks?.[c.id] ?? c.rateTicks
    const prev = spawnerFor.get(c.outputItem)
    if (!prev || cost(c.id) < cost(prev.catalogId)) {
      spawnerFor.set(c.outputItem, { catalogId: c.id, rateTicks })
    }
  }

  const procByOut = new Map(RECIPES.processor.map((r) => [r.out, r.in]))
  const combByOut = new Map(RECIPES.combiner.map((r) => [r.out, [r.a, r.b] as const]))
  const villagerOut = config.villageRecipe.output
  const bedId = config.villageRecipe.bed

  // Pick the cheapest raw (spawner-sourced) item of a category to feed the hut.
  const cheapestRawOf = (category: string): string | null => {
    let best: string | null = null
    let bestCost = Infinity
    for (const it of ITEMS) {
      if (it.category !== category) continue
      const sp = spawnerFor.get(it.id)
      if (!sp) continue
      const c = cost(sp.catalogId)
      if (c < bestCost) {
        bestCost = c
        best = it.id
      }
    }
    return best
  }
  const foodId = cheapestRawOf(config.villageRecipe.food)
  const drinkId = cheapestRawOf(config.villageRecipe.drink)

  // Throughput per tick of one line for `item`, gated by the slowest input.
  const rateMemo = new Map<string, number>()
  const rate = (item: string, seen = new Set<string>()): number => {
    const cached = rateMemo.get(item)
    if (cached !== undefined) return cached
    if (seen.has(item)) return 0
    seen.add(item)
    let r = 0
    const sp = spawnerFor.get(item)
    if (sp) r = sp.rateTicks > 0 ? 1 / sp.rateTicks : 0
    else if (procByOut.has(item)) r = rate(procByOut.get(item)!, seen)
    else if (item === villagerOut) {
      if (foodId && drinkId) r = Math.min(rate(foodId, seen), rate(drinkId, seen), rate(bedId, seen))
    } else {
      const c = combByOut.get(item)
      if (c) r = Math.min(rate(c[0], seen), rate(c[1], seen))
    }
    rateMemo.set(item, r)
    return r
  }

  // Distinct machines (deduped) needed to produce `item` from raw, keyed so a
  // shared sub-step is counted once. Excludes the terminal (seller/town hall).
  const collect = (item: string, acc: Map<string, number>, seen = new Set<string>()): void => {
    if (seen.has(item)) return
    seen.add(item)
    const sp = spawnerFor.get(item)
    if (sp) {
      acc.set('sp:' + sp.catalogId, cost(sp.catalogId))
      return
    }
    if (procByOut.has(item)) {
      acc.set('proc:' + item, PROC)
      collect(procByOut.get(item)!, acc, seen)
      return
    }
    if (item === villagerOut) {
      acc.set('hut:' + item, HUT)
      if (foodId) collect(foodId, acc, seen)
      if (drinkId) collect(drinkId, acc, seen)
      collect(bedId, acc, seen)
      return
    }
    const c = combByOut.get(item)
    if (c) {
      acc.set('comb:' + item, COMB)
      collect(c[0], acc, seen)
      collect(c[1], acc, seen)
    }
  }

  const lineFor = (item: string, terminal: number): LineDef => {
    const acc = new Map<string, number>()
    collect(item, acc)
    const machines = [...acc.values()].reduce((s, v) => s + v, 0)
    const spawners = [...acc.keys()].filter((k) => k.startsWith('sp:')).map((k) => k.slice(3))
    const ratePerTick = rate(item)
    return {
      item,
      ratePerTick,
      incomePerTick: ratePerTick * price(item),
      baseCost: machines + acc.size * BELT + terminal, // ~one belt per machine
      // producers + one belt each + the terminal machine (seller / town hall)
      machineCount: acc.size * 2 + 1,
      spawners,
    }
  }

  const hasProducer = (id: string) =>
    spawnerFor.has(id) || procByOut.has(id) || combByOut.has(id) || id === villagerOut

  const isVillager = (id: string) => ITEMS_BY_ID[id]?.category === 'villager'

  const sellLines: LineDef[] = ITEMS.filter(
    (it) => it.id !== config.junkItemId && !isVillager(it.id) && hasProducer(it.id),
  )
    .map((it) => lineFor(it.id, SELLER))
    .filter((l) => l.incomePerTick > 0)

  const buffLines: Record<string, LineDef> = {}
  for (const it of ITEMS) {
    if (isVillager(it.id) && hasProducer(it.id)) {
      const line = lineFor(it.id, HALL)
      if (line.ratePerTick > 0) buffLines[it.id] = line
    }
  }

  // Bootstrap: the free starter kit (ore gatherer → belt → storage) with the
  // player manually selling ore. Modelled as an ore line auto-selling from t=0
  // at no cost, exactly like scaling.ts's bootstrap.
  const bootstrap = lineFor('ore', 0)

  return { sellLines, buffLines, bootstrap }
}

// --- Simulation ---------------------------------------------------------------

export interface SpawnerMilestone {
  catalogId: string
  name: string
  cost: number
  /** Real (calendar) ms into the run when this spawner was first built. */
  atMs: number
  atDay: number
}

export interface Sample {
  atMs: number
  atDay: number
  money: number
  /** Money + total invested (a rough net-worth proxy). */
  netWorth: number
  incomePerTick: number
  sellMultiplier: number
  linesBuilt: number
}

export interface SimResult {
  profile: PlayerProfile
  /** When each spawner variant was first built (undefined ones were never reached). */
  spawnerMilestones: SpawnerMilestone[]
  /** Real days to build the single most expensive spawner (the "end game"), or null. */
  endGameDay: number | null
  /** Per-session samples of the money/income/buff trajectory. */
  samples: Sample[]
  finalMoney: number
  finalNetWorth: number
  finalIncomePerTick: number
  finalModifiers: TownModifiers
  /** Banked villagers by type at the end of the run. */
  bankedVillagers: Record<string, number>
  /** Sell-line copies built (each unlocks/scales one auto-sold item). */
  sellLinesBuilt: number
  /** Villager-buff lines built (each banks one villager type into a town hall). */
  buffLinesBuilt: number
}

interface BuffLineInstance {
  type: string
  ratePerTick: number
  /**
   * Active-play ms at which it was built. Town halls bank villagers only while
   * the game is open — offline catch-up (see offline.ts) extrapolates storage
   * and sellers but NOT town halls — so buff accumulation is driven by the
   * active clock, not wall-clock. This is what keeps buffs a real time
   * investment rather than free compounding.
   */
  builtActiveMs: number
}

/**
 * Simulate `days` of play for one profile. Pure and deterministic.
 *
 * Two clocks are kept: `wallMs` is real calendar time (milestones are reported
 * against it — "how quickly"), while `prodMs` is *effective production time*,
 * which advances by the full session length but only by `min(gap, cap)` across
 * an offline gap. Both money earned offline and villagers banked are driven by
 * `prodMs`, so a player who vanishes for a week only gets `maxOfflineHours` of
 * catch-up, matching the live game.
 */
export function simulate(
  profile: PlayerProfile,
  opts: { days?: number; overrides?: SimOverrides } = {},
): SimResult {
  const days = opts.days ?? 30
  const model = buildProductionModel(opts.overrides ?? {})
  const tickMs = config.tickMs
  const capMs = config.maxOfflineHours * 3_600_000
  const sessionMs = profile.sessionMinutes * MS_PER_MINUTE
  const gapMs = Math.max(0, MS_PER_DAY / profile.sessionsPerDay - sessionMs)
  // A session's hands-on placement budget, in machines.
  const machineBudget = Math.max(1, Math.round(profile.sessionMinutes * profile.machinesPerMinute))
  const buffPriority = profile.buffPriority ?? DEFAULT_BUFF_PRIORITY

  const sellLineByItem = new Map(model.sellLines.map((l) => [l.item, l]))

  // Player state. Three clocks: `wallMs` is calendar time (milestones), `prodMs`
  // is offline-capped production time (drives offline sell earnings), and
  // `activeMs` is hands-on play time (drives villager banking — see below).
  let money = 0
  let wallMs = 0
  let prodMs = 0
  let activeMs = 0
  // item id -> number of copies of that sell line built.
  const builtCounts = new Map<string, number>()
  const buffInstances: BuffLineInstance[] = []
  let investedTotal = 0

  // Bootstrap: the free ore line is "built" (its spawner acquired) from t=0.
  builtCounts.set(model.bootstrap.item, 1)

  const spawnerMilestones = new Map<string, SpawnerMilestone>()
  const recordSpawners = (line: LineDef) => {
    for (const catalogId of line.spawners) {
      if (spawnerMilestones.has(catalogId)) continue
      const entry = CATALOG_BY_ID[catalogId]
      spawnerMilestones.set(catalogId, {
        catalogId,
        name: entry?.name ?? catalogId,
        cost: entry?.cost ?? 0,
        atMs: wallMs,
        atDay: wallMs / MS_PER_DAY,
      })
    }
  }
  recordSpawners(model.bootstrap)

  // Base (pre-buff) income per tick = sum over every built line.
  const baseIncomePerTick = (): number => {
    let inc = 0
    for (const [item, n] of builtCounts) {
      const line = item === model.bootstrap.item ? model.bootstrap : sellLineByItem.get(item)
      if (line) inc += line.incomePerTick * n
    }
    return inc
  }

  // Villagers banked so far = each buff line's rate × its ACTIVE lifetime (town
  // halls do not accumulate while offline; see BuffLineInstance).
  const bankedVillagers = (): Record<string, number> => {
    const totals: Record<string, number> = {}
    for (const b of buffInstances) {
      const banked = b.ratePerTick * ((activeMs - b.builtActiveMs) / tickMs)
      totals[b.type] = (totals[b.type] ?? 0) + banked
    }
    return totals
  }

  const currentModifiers = (): TownModifiers => {
    const totals = bankedVillagers()
    if (Object.keys(totals).length === 0) return computeTownModifiers(new Map())
    const halls: Map<string, TownHallState> = new Map([['sim', totals]])
    return computeTownModifiers(halls)
  }

  const samples: Sample[] = []
  const sample = (mods: TownModifiers) => {
    let lines = 0
    for (const n of builtCounts.values()) lines += n
    samples.push({
      atMs: wallMs,
      atDay: wallMs / MS_PER_DAY,
      money,
      netWorth: money + investedTotal,
      incomePerTick: baseIncomePerTick(),
      sellMultiplier: mods.sellMultiplier,
      linesBuilt: lines,
    })
  }

  // Spend the session's budget. A session can only lay down so many lines
  // (`maxBuildsPerSession`), of which the buff fraction is reserved for the
  // villager pipeline; the rest funds sell lines. Sell building is
  // breadth-FIRST — a player chases new content (and its spawner) before
  // stacking copies of what they already have — then duplicates the best-ROI
  // line once every affordable new line is built.
  const spend = (mods: TownModifiers) => {
    const buildMult = mods.buildCostMultiplier
    let machinesLeft = machineBudget

    // --- Buff pipeline (capped share of the session's machine budget) --------
    if (profile.buffInvestmentFraction > 0) {
      let buffMachines = Math.round(machineBudget * profile.buffInvestmentFraction)
      let buffBudget = money * profile.buffInvestmentFraction
      let progressed = true
      while (progressed && buffMachines > 0) {
        progressed = false
        for (const type of buffPriority) {
          const line = model.buffLines[type]
          if (!line || line.machineCount > buffMachines) continue
          const c = Math.round(line.baseCost * buildMult)
          if (c <= buffBudget && c <= money) {
            money -= c
            buffBudget -= c
            investedTotal += line.baseCost
            buffInstances.push({ type, ratePerTick: line.ratePerTick, builtActiveMs: activeMs })
            recordSpawners(line)
            buffMachines -= line.machineCount
            machinesLeft -= line.machineCount
            progressed = true
            if (buffMachines <= 0) break
          }
        }
      }
    }

    // --- Sell lines: buy the highest-ROI affordable NEW line; only when none
    //     is affordable, duplicate the highest-ROI already-built line. --------
    while (machinesLeft > 0) {
      let bestNew: { line: LineDef; cost: number; roi: number } | null = null
      let bestDup: { line: LineDef; cost: number; roi: number } | null = null
      for (const line of model.sellLines) {
        if (line.machineCount > machinesLeft) continue
        const c = Math.round(line.baseCost * buildMult)
        if (c > money) continue
        const roi = line.incomePerTick / line.baseCost
        const bucket = builtCounts.has(line.item) ? 'dup' : 'new'
        if (bucket === 'new') {
          if (!bestNew || roi > bestNew.roi) bestNew = { line, cost: c, roi }
        } else if (!bestDup || roi > bestDup.roi) {
          bestDup = { line, cost: c, roi }
        }
      }
      const pick = bestNew ?? bestDup
      if (!pick) break
      money -= pick.cost
      investedTotal += pick.line.baseCost
      const isNew = !builtCounts.has(pick.line.item)
      builtCounts.set(pick.line.item, (builtCounts.get(pick.line.item) ?? 0) + 1)
      if (isNew) recordSpawners(pick.line)
      machinesLeft -= pick.line.machineCount
    }
  }

  const totalSessions = Math.max(1, Math.round(days * profile.sessionsPerDay))
  for (let s = 0; s < totalSessions; s++) {
    let mods = currentModifiers()

    // Offline gap before every session except the first.
    if (s > 0 && gapMs > 0) {
      const effGap = Math.min(gapMs, capMs)
      const inc = baseIncomePerTick()
      money += inc * mods.sellMultiplier * mods.offlineMultiplier * (effGap / tickMs)
      prodMs += effGap
      wallMs += gapMs
      mods = currentModifiers()
    }

    // Active session: earn from existing lines, then shop. Active play advances
    // all three clocks (it is also production time, and it is the only time town
    // halls bank villagers).
    const inc = baseIncomePerTick()
    money += inc * mods.sellMultiplier * (sessionMs / tickMs)
    prodMs += sessionMs
    activeMs += sessionMs
    wallMs += sessionMs
    mods = currentModifiers()
    spend(mods)
    mods = currentModifiers()
    sample(mods)
  }

  const finalMods = currentModifiers()
  const finalBanked = bankedVillagers()
  let sellLines = 0
  for (const n of builtCounts.values()) sellLines += n

  const milestoneList = [...spawnerMilestones.values()].sort((a, b) => a.atMs - b.atMs)
  // "End game" = the single most expensive spawner in the catalog.
  const priciestSpawner = CATALOG.filter((c) => c.kind === 'spawner').sort((a, b) => b.cost - a.cost)[0]
  const endGame = priciestSpawner ? spawnerMilestones.get(priciestSpawner.id) : undefined

  return {
    profile,
    spawnerMilestones: milestoneList,
    endGameDay: endGame ? endGame.atDay : null,
    samples,
    finalMoney: money,
    finalNetWorth: money + investedTotal,
    finalIncomePerTick: baseIncomePerTick(),
    finalModifiers: finalMods,
    bankedVillagers: finalBanked,
    sellLinesBuilt: sellLines,
    buffLinesBuilt: buffInstances.length,
  }
}

// --- Preset profiles ----------------------------------------------------------

/**
 * A spread of play patterns crossed with the two playstyles the balancing
 * question is about (ignore buffs vs. pour half your income into them). Tweak
 * or add to these when tuning; `simulate()` takes any profile.
 */
export const PRESET_PROFILES: PlayerProfile[] = [
  { name: 'Casual · seller', sessionMinutes: 10, sessionsPerDay: 1, machinesPerMinute: 12, buffInvestmentFraction: 0 },
  { name: 'Casual · buffs', sessionMinutes: 10, sessionsPerDay: 1, machinesPerMinute: 12, buffInvestmentFraction: 0.5 },
  { name: 'Regular · seller', sessionMinutes: 15, sessionsPerDay: 3, machinesPerMinute: 12, buffInvestmentFraction: 0 },
  { name: 'Regular · buffs', sessionMinutes: 15, sessionsPerDay: 3, machinesPerMinute: 12, buffInvestmentFraction: 0.5 },
  { name: 'Hardcore · seller', sessionMinutes: 30, sessionsPerDay: 6, machinesPerMinute: 12, buffInvestmentFraction: 0 },
  { name: 'Hardcore · buffs', sessionMinutes: 30, sessionsPerDay: 6, machinesPerMinute: 12, buffInvestmentFraction: 0.5 },
  { name: 'Lapsed · seller', sessionMinutes: 20, sessionsPerDay: 0.5, machinesPerMinute: 12, buffInvestmentFraction: 0 },
  { name: 'Lapsed · buffs', sessionMinutes: 20, sessionsPerDay: 0.5, machinesPerMinute: 12, buffInvestmentFraction: 0.5 },
]
