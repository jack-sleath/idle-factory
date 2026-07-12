# Title: Costs, Catalog & Free-Basics Economy

<details>
<summary>Original Spec</summary>

## Milestone 6 — Costs, catalog & free-basics economy
**Goal:** Machines cost money to build; a free-basics safety net plus the starter kit make the earn→buy→expand loop work.

**Tasks:**
- Flesh out `data/catalog.json`: each buildable has `{ id, kind, emoji, cost, freeIfNonePlaced? }`; spawner entries add `{ outputItem, rateTicks }` (basic ore gatherer ⛏️→🪨, cow 🐄→🥛, deep miner →rarer ore, …). Basics set `freeIfNonePlaced: true`.
- **Buying = placing:** deduct `cost` money on placement; disable/grey a tool the player can't afford; no refund on delete.
- **First-free basics:** the basic ore gatherer, basic conveyor, and basic storage cost 0 **only while you have none of that basic placed** (first free); additional copies cost the catalog price (anti-soft-lock).
- Palette shows each buildable's cost; `startingMoney` defaults to 0 (bootstrap via free basics).
- Confirm the starter kit (seeded in M2) plus free basics guarantee recovery from a fully-deleted world.

**Done when:**
- [ ] Placing a priced machine deducts its cost; an unaffordable machine can't be placed.
- [ ] The first basic ore gatherer, conveyor, and storage (when none of that basic is placed) are free; a second of each costs money.
- [ ] After deleting everything to $0, the player can rebuild an earning setup from the free-first basics.
- [ ] Buying a spawner variant (e.g. cow) produces a different item.
</details>

## Technical Notes
- `data/catalog.json` entries: `{ id, kind, emoji, cost, freeIfNonePlaced? }`; spawner entries add `{ outputItem, rateTicks }`.
- Buying = placing: cost is deducted on placement; there is no refund on delete.
- A tool is disabled/greyed when the player cannot afford its effective cost.
- First-free basics (ore gatherer, conveyor, storage): effective cost is 0 while none of that basic is currently placed; additional copies cost the catalog price.
- Palette shows each buildable's cost; `startingMoney` defaults to 0 (bootstrap relies on free basics).
- Starter kit (M2) + free basics must guarantee recovery from a fully-deleted world (no soft-lock).

## Acceptance Criteria

### 1. Placing a priced machine deducts its cost
**GIVEN** the player has enough money for a priced catalog machine
**WHEN** the player places it
**THEN** its `cost` is deducted from money and the machine appears in the world.

### 2. Unaffordable machines cannot be placed (negative path)
**GIVEN** the player cannot afford a machine
**WHEN** they view the palette and attempt to place it
**THEN** its tool is disabled/greyed and no placement occurs (money unchanged).

### 3. First of each basic is free
**GIVEN** none of a given basic (ore gatherer / conveyor / storage) is currently placed
**WHEN** the player places that basic
**THEN** its effective cost is 0 and no money is deducted.

### 4. Second of each basic costs money
**GIVEN** one of a given basic is already placed
**WHEN** the player places another of the same basic
**THEN** the catalog price is deducted (and it cannot be placed if unaffordable).

### 5. Rebuild from $0 via free-first basics
**GIVEN** the world has been fully deleted and money is $0
**WHEN** the player places one free ore gatherer, one free conveyor, and one free storage
**THEN** they can assemble an earning setup without spending money.

### 6. Spawner variant produces its configured item
**GIVEN** a purchased spawner variant (e.g. the cow) is placed
**WHEN** it emits
**THEN** it produces its configured output item (e.g. milk), distinct from the basic ore gatherer's output.

### 7. Deleting a machine gives no refund (negative path)
**GIVEN** a placed, priced machine
**WHEN** the player deletes it
**THEN** no money is refunded.

## Open Questions
- **MANUAL REVIEW:** If a player deletes their only placed basic (e.g., the sole conveyor), does it immediately become free-to-place again (i.e., "none placed" re-enables the free tier)?
- **MANUAL REVIEW:** Should the greyed/disabled affordability state update live as money changes, or only when a tool is selected?
