# CLAUDE.md

Guidance for Claude Code working in this repo. Auto-Exportica is an idle
factory game (Vite + React + TypeScript, Canvas 2D, Zustand). See `README.md`
for the player-facing pitch and `MILESTONES.md` for how it was built.

## Quick orientation

The game is **data-driven**: items, buildable machines, and recipes are all
defined in JSON under `src/data/`, and the rest of the code reads from those
files through the typed accessors in `src/data/index.ts`. Adding content is
overwhelmingly a matter of editing JSON — you rarely touch engine code.

- `src/data/items.json` — every item type (id, name, emoji, prices).
- `src/data/catalog.json` — every buildable thing in the shop palette.
- `src/data/recipes.json` — processor (1→1) and combiner (2→1) transforms.
- `src/data/config.ts` — global tuning knobs (tick rate, save version, etc.).
- `src/data/index.ts` — typed views + O(1) lookups over the three JSON files.
- `src/game/types.ts` — the domain types (`ItemDef`, `CatalogEntry`,
  `ProcessorRecipe`, `CombinerRecipe`, `MachineKind`, `Machine`).

The simulation is a pure `step(state) -> state` function in `src/game/tick.ts`
(same engine runs live play and offline catch-up). Rendering is in
`src/render/` (emoji rasterized to canvas bitmaps via `sprites.ts`). The
Zustand store in `src/store/gameStore.ts` glues placement, ticks, saving, and
the market together.

Commands: `npm run dev`, `npm run test` (vitest), `npm run build` (typecheck +
prod build), `npm run simulate` (balancing report). Tests live in `test/`.

---

## Balancing the gameplay loop (`npm run simulate`)

There are two economy models, both headless and both **idealised on purpose**
(no grid/belt geometry — they model the factory as a portfolio of
self-contained, auto-selling production lines). Their numbers are only
meaningful *relative to each other*, for comparing tuning changes:

- `src/game/scaling.ts` — the analytical "time to full automation" report shown
  in the in-app Admin screen. Answers "how long from a fresh start until every
  item is auto-sold?" for the *current* economy.
- `src/game/simulator.ts` — a longer-horizon **player-profile simulator**. It
  wraps the same line-economy in a calendar-time loop (active sessions that earn
  + build, offline gaps that earn at the capped offline rate) so you can ask
  "how quickly does each kind of player reach the expensive end-game spawners,
  and does chasing villager buffs pay off?" `scripts/simulate.ts` runs every
  `PRESET_PROFILES` entry over ~a month and prints a comparison;
  `npm run simulate -- 60` sweeps 60 days, `npm run simulate -- 30 json` dumps
  machine-readable results.

A **profile** is session length, sessions/day (fractional = less than daily),
machines placed per active minute (bounds how fast the factory grows — a long
villager chain eats far more of this than a short sell line), and
`buffInvestmentFraction` (share of money/build-budget routed into the villager
buff pipeline vs. sell lines).

Key modelling assumptions (all in the header comment of `simulator.ts`) —
important because they decide what the tool can and can't tell you:
- Prices are each item's **mean** (`startingValue`): an auto-seller sells into a
  mean-reverting market at whatever the price is. So the market-*timing* levers
  (`guard`/`farmer`/`miner`, which only widen the price band) show ~no effect
  here; the compounding levers (`merchant`/`mason`/`innkeeper`) do.
- **Town halls only bank villagers during active play** — offline catch-up
  (`offline.ts`) extrapolates storage and sellers but *not* town halls — so buff
  strength is gated by hands-on time, not wall-clock.
- Spawners have **per-copy cost growth** (`costGrowth`), so duplicating a line
  gets pricier; plumbing is flat. Reinvestment still compounds hard, so treat
  net-worth magnitudes as ordinal and prefer the *time-to-spawner* milestones as
  the stable headline metric.
- The simulator plays *optimally* (auto-sell everything, ROI-greedy building,
  aggressive duplication), so its times are a **lower bound** — a real casual
  player is slower. Tune the fast profiles to "a bit faster than you want" and
  real play lands where you intend.

To sweep the buff levers themselves, edit `config.townLevers` /
`config.townLeverFloors` / `config.townScaling` and re-run — the simulator reads
them through the real `computeTownModifiers`, so what you tune is what it
measures. `townScaling.diminishingExponent` (<1) makes villagers stack
sub-linearly so buffs can't run away (see `effectiveVillagers` in `town.ts`). To sweep prices /
build costs / spawner rates without editing data, pass `SimOverrides` to
`simulate()` (same shape as `scaling.ts`'s overrides).

---

## How the economy scales (read before costing new content)

The whole progression is a race between two exponentials: **income compounds**
(sell → reinvest → more sellers → more income) and **spawner costs compound**
per copy (`costGrowth`). A few hard-won facts about how they interact — they
decide what a new item/recipe/spawner does to the curve:

1. **Income massively out-scales raw costs.** A tick is 500 ms and offline
   earning runs up to `maxOfflineHours` (24h) a day, so *one* modest line earns
   tens of thousands of coins a day. Against that, a three-figure spawner is
   free money. This is why the deposit tier is priced in the hundreds of
   thousands to millions — costs only gate progress when they're on the same
   order as *daily income*, not per-item price.

2. **Any cheap productive spawner floods the economy.** Optimal play duplicates
   the best income/cost line relentlessly, so making *anything* cheap that
   feeds a decent-value sell item (even $15 swords, let alone $38 pies) lets a
   min-maxer bankroll the whole tech tree in a day or two. You cannot gate the
   end-game by pricing a *subset* of spawners high while their inputs stay cheap
   — the cheap inputs' own sell lines pay for everything. Gating requires the
   *lucrative* producers themselves to be expensive.

3. **So the spawner ladder is two tracks** (see `catalog.json`):
   - **Farm track** (`ore`, `oak`, `well`, `sheep`, veg, fruit, `cow`,
     `sugarcane`): cheap (tens of thousands). This is the early game *and* the
     whole villager/buff chain — see below — so it must stay affordable.
   - **Deposit track** (`silver`, `gold`, `sapphire`, `emerald`, `ruby`,
     `diamond`): expensive (hundreds of thousands → millions). These are the
     "end-game spawners", the premium goal. Their high cost mostly signals
     *tier*; it does not hard-gate an optimal player (see #2).
   All spawners carry `costGrowth: 1.15` so no single line duplicates to
   infinity.

4. **The villager/buff track needs no gems.** A villager is
   `food + drink + bed` (`bed = planks + wool`, `drink = water`), and every
   specialist is `villager + one cheap item` (merchant←ring, guard←iron-sword,
   innkeeper←bed, mason←planks, farmer←wheat, miner←ore). All of that is farm
   track, so the town hall is reachable early (~day 1–2) without touching the
   deposit track. Keep it that way: **do not** make a new villager/specialist
   recipe depend on a deposit-track item, or you re-gate buffs behind the
   end-game.

5. **Villager buffs have diminishing returns** (`townScaling`,
   `effectiveVillagers`): banked count scales as `count ^ 0.5`, and the
   reduction levers are floored (`townLeverFloors`). Without this the linear
   `townLevers` made banked villagers in the thousands give absurd multipliers.
   A new buff should be modest per-unit and, if it's a reduction, floored.

### Costing a new item

Set `startingValue` by where the item sits in the sell economy, because that —
times its production rate — is the income it injects:
- **Raw / material** ($1–5): ores, wood, wool, wheat, water, raw veg. Low value,
  just feedstock.
- **Basic product** ($6–20): bread, cheese, juices, simple weapons, single-gem
  jewellery. The bread-and-butter mid game.
- **Premium product** ($20–90): pies, sweet pies, gem rings/amulets, gold/diamond
  swords. These are the income engine; they should sit behind the deposit track
  or behind long recipe chains, not behind cheap raw spawners.
- **Valuable raw** ($8–50): the gems themselves, sold direct.

A high-value item is only "end-game" if *its whole recipe chain* bottoms out at
an expensive (deposit-track) spawner. If it can be built from farm-track inputs,
it will be spammed early regardless of its price — check with `npm run simulate`.

### Costing a new spawner

Decide the track. Farm-track raw feedstock → tens of thousands, `costGrowth`
~1.15. A rare/valuable resource meant as a progression goal → deposit track,
hundreds of thousands to millions. Then **run `npm run simulate`** and read
`firstBuffDay` / the end-game-spawner day for the `Daily 1h` and `Light`
profiles: farm additions should barely move them; a deposit addition should slot
into the late ladder. If a "cheap" addition pulls the end-game day in sharply,
its output is feeding a lucrative sell line (#2) — raise the value's gate or the
spawner's tier.

---

## Adding a new item

An "item" is anything that rides a belt (raw resource, intermediate, product,
or junk). Items are defined once in `src/data/items.json`:

```json
{ "id": "cheese", "name": "Cheese", "emoji": "🧀", "category": "food", "startingValue": 6 }
```

Field meaning (see `ItemDef` in `src/game/types.ts`):
- `id` — unique string key; referenced by catalog `outputItem` and by recipes.
- `name` / `emoji` — display only. The emoji is the sprite (rasterized by
  `src/render/sprites.ts`). **If the emoji is new to the repo you must vendor
  its icon** — see "Emoji icons" below; nothing else to register.
- `category` — one of `ITEM_CATEGORIES` (`food`, `drink`, `valuable`,
  `weapon`, `material`, `misc`); groups items in the market/shop UI.
  `validateData()` rejects an unknown value. Rule of thumb: `material` is
  anything whose only value is as an in-between production step (ores, bars,
  wood, textile, wheat/sugarcane/sugar, dough, pie cases); raw things that are
  food/treasure in their own right keep that identity (an apple is `food`, a
  diamond is `valuable`); `misc` is the catch-all (furniture, junk).
- `startingValue` — base sale price; also the market's reset/crash-to value,
  **and** the anchor its crash band is derived from. The market floor/ceiling
  are `startingValue × config.crashFloorMultiple` / `crashCeilingMultiple`
  (global knobs in `src/data/config.ts`); when a price walks down to the floor
  or up to the ceiling it "crashes" back to `startingValue`. See `priceBand()`
  in `src/game/market.ts`. Items carry no per-item price band of their own.
  For *where to pitch* the value and how it affects pacing, see "How the economy
  scales" above ("Costing a new item").

What happens automatically once an item exists:
- **Market**: `seedMarket()` in `src/game/market.ts` iterates `ITEMS`, so every
  new item gets a live price and sparkline for free.
- **Selling / pricing**: `basePrice()` and the market read through
  `ITEMS_BY_ID`, so sellers and storage Sell-All price it correctly.
- **Rendering**: any belt/storage/buffer holding the item draws its emoji —
  *provided its icon is vendored* (see "Emoji icons" below).

Gotchas:
- **A brand-new emoji renders as nothing until its icon is vendored.** The app
  draws committed Twemoji SVGs from `public/twemoji/`, not live system emoji, so
  after adding an item (or machine) whose emoji is new to the repo, run
  `node scripts/vendor-twemoji.mjs`. See "Emoji icons" below.
- An item that isn't produced by any spawner/recipe will just never appear —
  define its source (a spawner in `catalog.json` or a recipe in `recipes.json`)
  too.
- The `junk` item (`id: "junk"`) is special: it's the fallback output for
  un-matched processor/combiner inputs, configured via `config.junkItemId` in
  `src/data/config.ts`. Don't remove it.
- **Bump `config.saveVersion`** if you change the item *set* (see "Save
  migration" below).

---

## Adding a new machine

There are two very different cases. Read this distinction first.

### Case A — a new *variant* of an existing kind (the common case)

Most "new machines" are just new **catalog entries** reusing an existing
`MachineKind` — e.g. a new spawner that emits a different item, or a
higher-capacity storage. This is **pure `catalog.json` data**, no engine
changes.

Add an entry to `src/data/catalog.json` (see `CatalogEntry` in
`src/game/types.ts`):

```json
{
  "id": "gold-mine",
  "kind": "spawner",
  "name": "Gold Mine",
  "emoji": "🟡",
  "cost": 600000,
  "costGrowth": 1.15,
  "defaultDir": "E",
  "outputItem": "gold-ore",
  "rateTicks": 10
}
```

(For where to pitch `cost` — cheap farm track vs. expensive deposit track — and
how to verify with `npm run simulate`, see "How the economy scales" above.)

Fields:
- `id` — unique catalog id; this is what a placed `Machine` stores as
  `catalogId`, and it identifies spawner variants at runtime.
- `kind` — one of the existing `MachineKind`s: `spawner`, `belt`, `processor`,
  `combiner`, `storage`, `seller`, `splitter`.
- `name` / `emoji` — palette label + sprite. A new emoji needs its icon
  vendored (see "Emoji icons" below).
- `cost` — money to build the first paid copy. `freeIfNonePlaced: true` makes
  the *first* copy free while none are placed (used for the starter basics; see
  `src/game/economy.ts`).
- `costGrowth` — optional per-copy cost multiplier: the Nth placed copy costs
  `cost × costGrowth ^ placedCount`. Omitted / 1 = flat (every copy the same
  price). Spawners set this (~1.15) so raw-production can't be spammed into
  infinite income; plumbing (conveyors, sellers, storage, processors,
  combiners) stays flat. See `effectiveCost()` in `src/game/economy.ts`.
- `defaultDir` — facing when placed (defaults to `E`).
- `outputItem` + `rateTicks` — **spawner only**: which item id it emits and how
  many ticks between emissions (`tick % rateTicks === 0`). See `spawnerDue()` in
  `src/game/tick.ts`.
- `capacity` — **storage only**: max units held (see `storageCapacity()`).

That's it — the palette (`src/components/Palette.tsx`) maps over `CATALOG`
automatically, placement resolves it via `machineFromCatalog()` in the store,
and the tick engine reads `outputItem`/`rateTicks`/`capacity` from the catalog
entry at runtime. Spawner variants also show up in the `AdminScreen` tuning UI
(`src/components/AdminScreen.tsx`, which filters `kind === 'spawner'`).

### Case B — a genuinely new *kind* of machine (rare, engine-level)

A new behaviour (something that isn't a spawner/belt/processor/combiner/
storage/seller/splitter) is a much bigger change: the tick engine switches on
`Machine.kind` in several places. You must:

1. Add the kind to the `MachineKind` union in `src/game/types.ts`.
2. Handle it in `src/game/tick.ts` — this is the core work. The `step()`
   function has several `switch (m.kind)` / `switch (tm.kind)` blocks that ALL
   need a case: `readyToEmit`, `emittedValue`, `sourceOutDir` (if its output
   side isn't just `m.dir`), `accepts` (how it consumes input), and the main
   per-machine loop at the bottom (its state transition). Any new internal
   state also needs a `Map` on `SimState`.
3. Handle offline catch-up in `src/game/offline.ts` (it also switches on
   `kind` to trace production lines — `inputSideOf`, storage/seller edges).
4. Rendering in `src/render/renderer.ts` if it needs special drawing (e.g.
   belts rotate their sprite; splitters draw three chevrons). Default machines
   just draw upright with a single output chevron.
5. Persistence in `src/game/save.ts` if the kind carries new persisted state
   (like storage does), plus the store wiring in `src/store/gameStore.ts`.
6. Add a catalog entry (Case A) so it's buildable, and tests in `test/tick.test.ts`.

Use the `splitter` kind as a worked reference — it was added after the original
kinds and touches exactly these spots.

---

## Adding a new recipe

Recipes are in `src/data/recipes.json`, split into two lists.

**Processor** (1 input → 1 output), consumed by a `processor` machine:

```json
{ "in": "ore", "out": "bar" }
```

**Combiner** (2 inputs → 1 output), consumed by a `combiner` machine. The pair
is **order-independent** — `{a,b}` and `{b,a}` resolve to the same recipe (the
lookup canonicalizes by sorting):

```json
{ "a": "stick", "b": "bar", "out": "iron-sword" }
```

How they're consumed:
- `src/data/index.ts` builds `PROCESSOR_OUT_BY_IN` and `COMBINER_OUT_BY_PAIR`
  lookups at load, exposed as `processorOutput(in)` and `combinerOutput(a, b)`
  (both return `null` if no match).
- `src/game/tick.ts` calls these; any input with no matching recipe falls back
  to the `junk` item (`config.junkItemId`), so a processor/combiner never
  stalls on unknown input — it just produces worthless junk.

Gotchas:
- Every `in` / `out` / `a` / `b` id **must exist in `items.json`**. This is
  enforced by `validateData()` (`src/data/validate.ts`), which runs at build
  time (a Vite plugin in `vite.config.ts`) and in the test suite
  (`test/data.test.ts`) — a bad reference fails the build with a clear message
  instead of silently producing junk (bad input) or an unrenderable item (bad
  output). The same check covers catalog `outputItem` ids, duplicate item/
  catalog ids, the `junk` item, and spawner/storage completeness.
- Processor recipes can chain (`ore→bar`, then `bar→ring`); that's fine and
  expected — just place two processors in series.
- No quantity/ratio support: recipes are strictly 1→1 and 2→1, one item per
  slot per transform.

---

## Emoji icons (run this after adding any new emoji)

The app does **not** render live system emoji. It draws committed **Twemoji
14.0.2 SVGs** from `public/twemoji/` (rasterized in `src/render/sprites.ts`,
resolved to a filename by `src/lib/twemoji.ts`), and the service worker
precaches those files for offline use. An emoji with no matching
`<codepoint>.svg` in `public/twemoji/` renders as **nothing** — this is the
most common way a "finished" content change ships looking broken.

**So whenever you add or change an emoji** — a new item in `items.json`, a new
machine in `catalog.json`, or new UI chrome — re-vendor the icons:

```
node scripts/vendor-twemoji.mjs
```

The script derives the full emoji set from `items.json` + `catalog.json` + the
hardcoded `UI_CHROME` list, fetches each SVG from the pinned CDN, and writes
`public/twemoji/<codepoint>.svg`. It is idempotent (existing files are just
overwritten identically) and **exits non-zero if any emoji can't be fetched**,
so watch its output. **Commit the new SVGs** — they're what the app and the
offline cache actually load; the script is a build-time convenience, not a
runtime fetch.

Gotchas:
- If you add UI-only emoji (HUD/panel buttons, market category icons) that
  aren't in the data files, add them to `UI_CHROME` in
  `scripts/vendor-twemoji.mjs` or they won't be vendored.
- A missing icon is silent — nothing fails to build or test. The only signal is
  a blank sprite in-game, so re-running the script is the habit that prevents it.

---

## Save migration (do this when you change the content set)

Saves are versioned (`config.saveVersion` in `src/data/config.ts`) and stored
in localStorage. `src/game/save.ts` handles parse + migrate.

When you **change the item set or rename/remove catalog ids**, bump
`config.saveVersion`. On load, `migrateSave()` runs for any older save and:
- remaps renamed catalog ids via the `CATALOG_RENAMES` table (add your rename
  there so placed machines survive instead of becoming unknown tiles),
- drops machines whose `catalogId` no longer exists,
- prunes storage locked to items that no longer exist,
- reseeds the market (it's keyed by the old item set).

Adding *new* items/catalog/recipes without removing or renaming anything is
backward-compatible, but bumping the version is still the safe habit so old
saves get re-validated. When adding new items you generally do **not** need a
rename entry — only renames/removals need `CATALOG_RENAMES` or pruning logic.

---

## Testing

Run `npm run test`. Engine behaviour is covered headlessly (no browser):
- `test/tick.test.ts` — the simulation: spawning, belt movement, back-pressure,
  processor/combiner transforms, junk fallback, storage, splitter round-robin.
- `test/save.test.ts` — parse/migrate round-trips.
- `test/data.test.ts` — content integrity: asserts `validateData()` finds no
  broken item references (see the recipe section above).
- `test/market.test.ts`, `test/offline.test.ts`, `test/economy.test.ts`,
  `test/scaling.test.ts`, `test/store.test.ts` — the rest.

Add or extend a test when you add a recipe (assert the transform), a spawner
(assert emission timing), or especially a new machine *kind* (Case B).
