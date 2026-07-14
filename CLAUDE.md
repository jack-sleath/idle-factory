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
prod build). Tests live in `test/`.

---

## Adding a new item

An "item" is anything that rides a belt (raw resource, intermediate, product,
or junk). Items are defined once in `src/data/items.json`:

```json
{ "id": "cheese", "name": "Cheese", "emoji": "🧀", "startingValue": 6 }
```

Field meaning (see `ItemDef` in `src/game/types.ts`):
- `id` — unique string key; referenced by catalog `outputItem` and by recipes.
- `name` / `emoji` — display only. The emoji is the sprite (rasterized
  automatically by `src/render/sprites.ts`; nothing else to register).
- `startingValue` — base sale price; also the market's reset/crash-to value,
  **and** the anchor its crash band is derived from. The market floor/ceiling
  are `startingValue × config.crashFloorMultiple` / `crashCeilingMultiple`
  (global knobs in `src/data/config.ts`); when a price walks down to the floor
  or up to the ceiling it "crashes" back to `startingValue`. See `priceBand()`
  in `src/game/market.ts`. Items carry no per-item price band of their own.

What happens automatically once an item exists:
- **Market**: `seedMarket()` in `src/game/market.ts` iterates `ITEMS`, so every
  new item gets a live price and sparkline for free.
- **Selling / pricing**: `basePrice()` and the market read through
  `ITEMS_BY_ID`, so sellers and storage Sell-All price it correctly.
- **Rendering**: any belt/storage/buffer holding the item draws its emoji.

Gotchas:
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
  "cost": 150,
  "defaultDir": "E",
  "outputItem": "gold-ore",
  "rateTicks": 10
}
```

Fields:
- `id` — unique catalog id; this is what a placed `Machine` stores as
  `catalogId`, and it identifies spawner variants at runtime.
- `kind` — one of the existing `MachineKind`s: `spawner`, `belt`, `processor`,
  `combiner`, `storage`, `seller`, `splitter`.
- `name` / `emoji` — palette label + sprite.
- `cost` — money to build. `freeIfNonePlaced: true` makes the *first* copy free
  while none are placed (used for the starter basics; see `src/game/economy.ts`).
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
