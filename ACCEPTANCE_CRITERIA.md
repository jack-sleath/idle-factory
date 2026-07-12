# Acceptance Criteria

## Overview
Idle Factory is a browser-based idle/incremental factory game. On an effectively unbounded canvas world, the player places conveyor belts and machines (drawn as emoji sprites); raw materials spawn, flow along belts, are transformed by processors and combiners according to a recipe table, and are sold on a fluctuating stock market for money — including while offline via idle progression. Money buys better spawners and machines from a catalog; a free starter kit (ore gatherer → conveyor → storage) and a free-first-of-each basic mean the earn→buy→expand loop can always be bootstrapped. Progress is saved locally with manual export/import, and (later) syncs to Google Drive. It is installable as a PWA.

## Target User
Casual/idle-game players — primarily the author and friends — playing in a mobile or desktop browser, with no account required for the core game.

## Tech Stack
- **Language:** TypeScript
- **Framework(s):** React 18, built with Vite
- **State management:** Zustand
- **Rendering:** **Canvas 2D** grid renderer with a pan/zoom camera and viewport culling (React renders only the UI chrome, not the grid). Machines/items drawn as sprites — Twemoji `14.0.2` SVGs rasterized to bitmaps (matching `jack-sleath.github.io`); the sprite source is abstracted so a real spritesheet can replace it later. UI chrome icons use DOM Twemoji `<img>`. Market graphs are lightweight inline SVG sparklines (no chart dependency).
- **World model:** effectively unbounded, sparse (`Map<"x,y", …>`, signed coords) — no fixed grid size.
- **Database / storage:** Browser `localStorage` (versioned JSON save); manual JSON download/upload; Google Drive sync (later)
- **PWA:** installable + offline via `vite-plugin-pwa` (web manifest + Workbox service worker), precaching the app shell + vendored Twemoji SVGs
- **Hosting/Infrastructure:** GitHub Pages (project site) at `https://jack-sleath.github.io/idle-factory/`, deployed via GitHub Actions (deploy wiring is a later milestone)

## Functional Requirements
1. The system must render the play area on a **pan/zoom canvas** over an **effectively unbounded, sparse world** (no fixed grid size); only the visible viewport is drawn. Machines and items appear as emoji sprites (no bespoke graphics for now).
2. The system must render all emoji from Twemoji `14.0.2` SVG assets — grid sprites rasterized from them, UI chrome icons as DOM images — so they appear consistently across devices.
3. The palette offers build tools (one per machine kind) plus **Select, Rotate, and Delete** tools; the selected tool determines what tapping a cell does — place a machine, open its panel (Select), cycle its orientation (Rotate), or remove it (Delete). Touch-friendly for mobile.
4. The system must support **conveyor belts** with an orientation (N/E/S/W), shown as an arrow sprite, that move the item on them one cell per tick toward their output side.
5. The system must support **spawner/source tiles** that emit a configured raw item out of their (orientation-defined) output side every N ticks when that cell is free.
6. The system must advance the simulation on a fixed tick (`tickMs` from config) as a pure state→state step; each item acts at most once per tick and moves exactly one cell per tick, with correct back-pressure when the destination is occupied and deterministic resolution when two belts feed one cell.
7. The system must support **processors** (orientable: input side → opposite output side) that transform an input item into an output item in one tick according to a processor recipe, holding if the output is blocked.
8. The system must support **combiners** (two input sides + one output side) that buffer one item per input and, when both are present, combine them into an output item according to a combiner recipe matched as an **order-independent pair**.
9. The system must store recipes in a JSON array (both processor and combiner recipes).
10. The system must produce a **junk** item when a processor receives an unprocessable item, or when a combiner receives two items with no matching recipe.
11. The system must support **storage containers** that lock to the first item type conveyed into them, accumulate a count of only that type (up to a capacity), and reject non-matching items. Each container displays the current market value of its contents (unit price and total) and provides a **Sell All** action that sells the entire stockpile at the current market price and adds the proceeds to money.
12. The system must support **auto-sellers** that, while the game is open (online), immediately sell any item entering them at that item's current market price, adding to the player's money. While the game is closed (offline) they are paused and instead **buffer** incoming items (acting as temporary storage); on return, the offline calculation (see #16) sells each seller's buffered items once at the current market price.
13. The system must maintain a **stock market** in which every item has a live price. Every `X` minutes (configurable), each price is multiplied by a **geometrically neutral** random factor in ×[1/1.2, 1.2] (log-symmetric, so there is **no long-run drift**). If a price reaches its `minPrice` or `maxPrice`, that item's market **crashes and resets to its starting value**. The market state (current prices, last-update time, and a rolling history of the **last 10 values** per item) is persisted as part of the saved game.
14. The system must display the player's money (formatted Cookie-Clicker-style: abbreviated/named large numbers), current market prices, and a **graph** of each item's recent price movement (its last 10 values).
15. The system must autosave game state to `localStorage` and restore it on reload.
16. The system must apply **offline idle progression** when the app becomes visible again (state and `savedAt` are persisted when it becomes hidden), capped at a configurable maximum (default **24 hours**, applied to **both** market catch-up and production). No sales happen *during* the offline period (never at fluctuating offline prices). It advances the market by the capped elapsed time, samples the live tick engine for a short window (default ~1 minute, sellers paused, after a warm-up) to measure each accumulator's intake rate, then extrapolates: **storage containers** gain items clamped to remaining capacity (held for manual sale), while **auto-sellers** accumulate a buffer that is sold once at the caught-up current price, crediting money. In-flight items on belts are **cleared** across the skip. It then presents an away summary (elapsed time, items stockpiled in storage, and money auto-earned from seller buffers).
17. The user can export the full game state as a downloadable JSON file and import it back to restore state.
18. The system must use a versioned save schema to allow future migration.
19. The system must provide a **catalog** of buildable machines, each with a money **cost**; the palette/shop is generated from it and shows costs. Placing a machine deducts its cost (buying = placing; no refund on delete), and the player cannot place a machine they cannot afford.
20. The **first** basic ore gatherer, basic conveyor, and basic storage are **free** — each costs 0 only while none of that basic is currently placed; additional copies cost their catalog price. This guarantees a broke player can always place one free of each to rebuild an earning setup (no soft-lock).
21. A **new game** must seed a working starter kit — one basic ore gatherer feeding one conveyor into one basic storage, positioned to earn. Additional **spawner variants** (e.g. a cow producing milk, a deep miner producing a rarer ore) are purchasable catalog entries that output different items.
22. The system must be installable as a **Progressive Web App** (web manifest + service worker) and run offline, precaching the app shell and the **vendored** Twemoji SVG assets so the game and its emoji work without a network connection.
23. (Later) The user can authorize Google Drive and save/load their game state to/from Drive.

## Non-Functional Requirements
- **Mobile support:** the game must be comfortably playable one-handed in a phone browser (responsive layout, large tap targets, no accidental zoom/scroll during placement).
- **Performance:** the canvas renders only the visible viewport (culling) over a sparse world, so render cost is independent of world size and tick cost scales with factory size, not area. Offline catch-up runs off the render path (headless): it samples a short fixed window (~1 minute) and extrapolates, staying near-instant regardless of absence length.
- **Unbounded world:** there is no maximum world size; memory scales with the number of placed machines/items, not the world area.
- **Offline-first core:** the core game must run fully offline with no account (localStorage only).
- **Installable & offline (PWA):** the app is installable to the home screen and works offline via a service worker that caches the app shell and Twemoji assets.
- **Deterministic simulation:** the tick step is a pure `state → state` function, driven by a single monotonic tick counter, so it can be run headlessly to sample offline production rates.
- **Cross-device visual consistency:** emoji must render identically across platforms via Twemoji.
- **Configurability:** tick rate, market interval, market volatility (default 0.2 → factor ×[1/1.2, 1.2]), starting money (default 0), the junk emoji, the maximum offline catch-up duration (default 24h, applied to both market and production), the offline sample-window length (default ~1 min), initial camera position/zoom, and number-format style must be editable in one config location (no fixed grid size — the world is unbounded). Each item's starting value and `minPrice`/`maxPrice` live in the items table; each buildable's `cost` (and spawner output/rate) lives in the catalog.
- **Deployability:** the app must build to static assets served correctly under the `/idle-factory/` base path on GitHub Pages.

## Out of Scope
- Custom/bespoke artwork (emoji sprites only for now — the renderer is sprite-based, so a spritesheet can be swapped in later without re-architecting).
- Refunds when deleting machines, a separate buy-into-inventory step, and finite/depletable resource deposits (spawners emit infinitely for now).
- User accounts / multiplayer / server-side backend.
- Google Drive sync in the MVP (deferred to a dedicated later milestone).
- Monetization, ads, or analytics.
