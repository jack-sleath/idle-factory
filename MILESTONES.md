# Milestones

## Tech Stack
- **Language:** TypeScript
- **Framework(s):** React 18 + Vite
- **State management:** Zustand
- **Rendering:** Canvas 2D (pan/zoom camera + viewport culling) drawing Twemoji `14.0.2` sprites over a sparse, **unbounded** world; UI chrome uses DOM Twemoji
- **Database / storage:** `localStorage` (versioned JSON) + JSON export/import; Google Drive (later)
- **Hosting/Infrastructure:** GitHub Pages project site (`base: '/idle-factory/'`) via GitHub Actions (deploy is a later milestone)

---

## Milestone 1 — Scaffold + canvas sprite pipeline + PWA skeleton
**Goal:** A Vite/React/TS app that draws Twemoji sprites on a pannable canvas and installs as an offline PWA.

**Tasks:**
- Initialise Vite React-TS project; add Zustand; `tsconfig` strict; `vite.config.ts` with `base: '/idle-factory/'`.
- Vendor the Twemoji `14.0.2` SVGs we use into `public/twemoji/`; `lib/twemoji.ts` computes an emoji's codepoint filename → local SVG url (via `import.meta.env.BASE_URL`). Small DOM `<Emoji>` component for chrome.
- `render/sprites.ts` rasterizes an SVG to a cached bitmap; `render/camera.ts` + `render/renderer.ts` draw a few sprite tiles on a `<canvas>` in a rAF loop with pan (drag).
- Add `vite-plugin-pwa` with a web manifest (name, icons, theme color, `display: standalone`, `scope`/`start_url` under `/idle-factory/`) and a service worker that **precaches** the app shell + vendored SVGs.
- (Deploy workflow deferred to M11.)

**Done when:**
- [ ] `npm run dev` serves the app locally; `npm run build` succeeds under TS strict.
- [ ] The canvas draws Twemoji sprites that you can pan.
- [ ] The app is installable (manifest + service worker registered) and loads offline locally, with sprites still rendering.

---

## Milestone 2 — Sparse world, camera, placement & persistence
**Goal:** Pan/zoom an unbounded sparse world and place/rotate/delete every machine kind via the tool palette, persisted across reloads.

**Tasks:**
- Define `data/config.ts` (no grid size), `data/items.json`, `data/recipes.json`, `data/catalog.json`, `game/types.ts`.
- Zustand store holds the **sparse world** (`Map<"x,y", Machine>` + items map) with a chunk index for culling.
- Camera pan/zoom; pointer → world-cell mapping.
- `Palette` build tools come from the **catalog** — belt, storage, seller, processor, combiner, and multiple **spawner variants** (basic ore gatherer, cow→milk, deep miner→rarer ore) — plus **Select / Rotate / Delete**; the active tool governs taps. Machines carry an orientation. (Costs enforced in M6; placement is free here.)
- **New-game starter kit:** seed one basic ore gatherer → one conveyor → one basic storage.
- Debounced autosave to `localStorage`; persist state + `savedAt` on `visibilitychange → hidden`; restore on load.

**Done when:**
- [ ] You can pan/zoom the world on touch.
- [ ] Every machine kind can be placed, rotated (all machines), and deleted; orientation shows via the correct sprite.
- [ ] A new game starts with the pre-placed ore gatherer → conveyor → storage.
- [ ] Reloading restores the exact layout.

---

## Milestone 3 — Tick engine, belts & spawners
**Goal:** Items spawn and visibly travel along belts one cell per tick.

**Tasks:**
- Implement the tick step as a pure `state → state` function (next-state buffer) so it can also run headlessly in a loop — reused later for offline catch-up.
- Drive live play from a single monotonic tick counter at `tickMs` (rendering throttled/decoupled from the step).
- Spawners emit a configured raw item each interval when the output cell is free.
- **Pull-model** belt movement over the sparse world: empty cells pull from the upstream neighbor whose output points in; fixed priority (N,E,S,W) resolves two sources into one cell; packed belts advance as a unit; each item acts once per tick.
- Render items as sprites on top of belt cells.

**Done when:**
- [ ] A spawner→belt→belt chain visibly moves an item one cell each tick.
- [ ] A packed belt advances as a unit when the head clears; a blocked belt applies back-pressure without duplicating or dropping items; a merge resolves deterministically.

---

## Milestone 4 — Processors, combiners, recipes & junk
**Goal:** Machines transform items using the recipe JSON, with junk as the fallback.

**Tasks:**
- Recipe lookup for processor (1→1) and combiner (order-independent pair → 1) from `recipes.json`.
- Processor pulls from its input side, emits to its output side in 1 tick; **holds if output blocked**.
- Combiner buffers one item per input side; when both filled, emits the recipe output; holds if output blocked.
- Any non-matching processing or pairing emits the configured junk item.

**Done when:**
- [ ] A valid processor recipe transforms its input; a blocked output makes it hold (no loss).
- [ ] A valid combiner recipe combines two inputs (either input order) into one output.
- [ ] An unprocessable input or non-recipe pairing produces junk.

---

## Milestone 5 — Storage, sellers & money
**Goal:** Store one item type, sell items for money.

**Tasks:**
- Storage locks to the first item type in, accumulates a count up to a capacity, rejects others.
- **Select** tool opens a storage's panel showing current unit/total value and a **Sell All** button that liquidates at the current price. (Prices come from a static base table here; M6 makes them dynamic and the value updates automatically.)
- Auto-seller consumes incoming items and credits money at current price **while online**; a shared `online` flag gates behaviour (while offline it buffers items instead of selling — resolved in M9).
- Money shown in the HUD, formatted Cookie-Clicker-style via `lib/format.ts`.

**Done when:**
- [ ] Storage accumulates only its locked type (up to capacity) and rejects non-matching items.
- [ ] Selecting a storage shows its current value and **Sell All** banks the full stockpile.
- [ ] Items entering a seller (online) increase the money counter, shown with abbreviated large-number formatting.

---

## Milestone 6 — Economy: catalog, costs, shop & starter kit
**Goal:** Machines cost money to build; the free-basics safety net and starter kit make the earn→buy→expand loop work.

**Tasks:**
- Flesh out `data/catalog.json`: each buildable has `{ id, kind, emoji, cost, freeIfNonePlaced? }`; spawner entries add `{ outputItem, rateTicks }` (basic ore gatherer ⛏️→🪨, cow 🐄→🥛, deep miner →rarer ore, …). Basics set `freeIfNonePlaced: true`.
- **Buying = placing:** deduct `cost` from money on placement; disable/grey a tool the player can't afford; no refund on delete.
- **First-free basics:** basic ore gatherer, basic conveyor, basic storage cost 0 **only while you have none of that basic placed** (first of each free); additional copies cost their catalog price (anti-soft-lock).
- Palette shows each buildable's cost; `startingMoney` defaults to 0 (bootstrap from the free basics).
- Confirm the starter kit (seeded in M2) plus free basics guarantee recovery from a fully-deleted world.

**Done when:**
- [ ] Placing a priced machine deducts its cost; an unaffordable machine can't be placed.
- [ ] The first basic ore gatherer, conveyor, and storage (when none of that basic is placed) are free; a second of each costs money.
- [ ] After deleting everything with $0, the player can rebuild an earning setup from the free-first basics.
- [ ] Buying a spawner variant (e.g. cow) produces its different item.

---

## Milestone 7 — Stock market
**Goal:** Item prices fluctuate on a configurable cadence, are graphed, persist, and drive selling.

**Tasks:**
- Seed each price from its item's starting value; every `marketIntervalMinutes`, multiply each price by a **geometrically neutral** factor `exp((rand()*2−1)·ln(1+volatility))` (→ ×[1/1.2, 1.2], no long-run drift).
- Crash rule: if `price ≤ minPrice` or `price ≥ maxPrice`, reset to starting value and surface a crash indicator.
- Keep a rolling **last-10-values** history per item; render a per-item **graph** (inline SVG sparkline) in the market panel.
- Persist market state (prices, last-update time, 10-value histories) in the save; advance the market by elapsed intervals on load (capped at 24h).
- Sellers and storage **Sell All** use the live price.

**Done when:**
- [ ] Each interval multiplies prices by a neutral factor (verified: no systematic up/down drift over many steps).
- [ ] Hitting `minPrice` or `maxPrice` resets that item to its starting value.
- [ ] The market panel shows a graph of each item's last 10 values.
- [ ] Market state (including histories) persists across reload and is included in export/import.
- [ ] Sellers and Sell-All use the live price.

---

## Milestone 8 — Save management (export / import)
**Goal:** Manual, portable saves.

**Tasks:**
- Manual Save/Load buttons.
- Export downloads `idle-factory-save.json`.
- Import reads an uploaded file and restores state.
- Versioned save schema with a version field.

**Done when:**
- [ ] Export produces a valid JSON save file.
- [ ] Import fully restores game state from that file.

---

## Milestone 9 — Offline idle progression
**Goal:** The factory stockpiles goods while the tab/browser is closed, without selling.

**Tasks:**
- Trigger on `visibilitychange → visible`; on `→ hidden` persist state + `savedAt`.
- `elapsed = min(now - savedAt, maxOfflineHours)` clamped ≥ 0; the same capped value drives **both** market and production.
- Advance the market by `elapsed`.
- With the `online` flag off (sellers buffer instead of sell), sample the pure tick step headlessly for `offlineSampleSeconds` (default ~60s, after a warm-up) and measure each accumulator's intake per item type — **storage** and **auto-sellers**.
- Extrapolate over `elapsed`: storage gains `ratePerMs × elapsed` **clamped to remaining capacity**; each auto-seller's buffer is then **sold once at the caught-up current price**, crediting money.
- **Clear in-flight items off the belts** (items in transit disappear across a time skip); set `savedAt = now`.
- Show an away summary: elapsed time, items stockpiled in storage, money auto-earned from seller buffers.

**Done when:**
- [ ] Returning advances market + stockpiles with a single 24h cap on both; storage never exceeds capacity.
- [ ] Auto-sellers sell their buffer once at the caught-up price; no money is credited at fluctuating offline prices.
- [ ] In-flight belt items are cleared after the skip; the away summary shows stockpiles + earnings.
- [ ] Catch-up is near-instant even after a full-day absence (samples a short window, does not replay a day of ticks).

---

## Milestone 10 — Mobile & polish pass
**Goal:** Comfortable one-handed mobile play.

**Tasks:**
- Touch ergonomics; distinguish camera gestures (pan/pinch-zoom) from placement taps; large tap targets.
- Number-formatting polish; onboarding hint.

**Done when:**
- [ ] The game is comfortably playable one-handed on a phone.
- [ ] Camera gestures and placement taps don't interfere with each other.

---

## Milestone 11 — Deploy to GitHub Pages
**Goal:** Ship the app live and installable.

**Tasks:**
- `.github/workflows/deploy.yml`: build → upload Pages artifact → deploy, with `permissions: pages: write, id-token: write`.
- Set the repo's Pages source to "GitHub Actions".
- Verify assets, service worker scope, and manifest `start_url` all resolve under `/idle-factory/`.

**Done when:**
- [ ] `https://jack-sleath.github.io/idle-factory/` loads, installs as a PWA, and runs offline.

---

## Milestone 12 (deferred) — Google Drive sync
**Goal:** Optional cloud save/load via Google Drive.

**Tasks:**
- OAuth via Google Identity Services; Client ID as a config value.
- Save/load the JSON save to Drive (`appDataFolder`).
- Connect/disconnect UI.

**Done when:**
- [ ] After authorizing, the player can save to and load from Google Drive on the live Pages site.
