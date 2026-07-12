# Title: Storage, Sellers & Money

<details>
<summary>Original Spec</summary>

## Milestone 5 — Storage, sellers & money
**Goal:** Store one item type, and sell items for money.

**Tasks:**
- Storage locks the first item type in, accumulates a count up to capacity, and rejects others.
- **Select** tool opens a storage's panel showing the current unit/total value and a **Sell All** button that liquidates at the current price. (Prices come from a static base table here; M6/M7 make the value dynamic and it updates automatically.)
- Auto-seller consumes incoming items and credits money at the current price **while online**; a shared `online` flag gates behaviour (while offline it buffers items instead of selling — resolved in M9).
- Money shown in the HUD, formatted Cookie-Clicker-style via `lib/format.ts`.

**Done when:**
- [ ] Storage accumulates only the locked type (up to capacity) and rejects non-matching items.
- [ ] Selecting a storage shows its current value and **Sell All** banks the full stockpile.
- [ ] Items entering a seller (online) increase the money counter, shown with abbreviated large-number formatting.
</details>

## Technical Notes
- Storage locks to the first item type conveyed in, accumulates a count up to a capacity, and rejects other types.
- Select tool opens the storage panel showing current unit price and total value plus a Sell All button that sells at the current price.
- Prices come from a static base table in this milestone (dynamic market lands in M7; the display updates automatically once prices change).
- Auto-seller credits money at the current price while the shared `online` flag is set; while offline it buffers incoming items instead of selling (resolved in M9).
- Money is shown in the HUD, formatted Cookie-Clicker-style (abbreviated/named large numbers) via `lib/format.ts`.

## Acceptance Criteria

### 1. Storage locks to the first item type
**GIVEN** an empty storage container
**WHEN** the first item is conveyed into it
**THEN** the container locks to that item's type for subsequent intake.

### 2. Storage accumulates up to capacity
**GIVEN** a storage container locked to an item type and below capacity
**WHEN** matching items are conveyed in
**THEN** its count increases up to the configured capacity.

### 3. Storage rejects non-matching items (negative path)
**GIVEN** a storage container locked to item type A
**WHEN** an item of a different type arrives
**THEN** it is not accepted into the container (it is rejected / held on the belt).

### 4. Storage panel shows current value
**GIVEN** the Select tool is active and a storage container holds items
**WHEN** the user taps the container
**THEN** a panel opens showing the current unit price and total value of the contents, plus a Sell All action.

### 5. Sell All banks the stockpile
**GIVEN** the storage panel is open with a non-empty stockpile
**WHEN** the user taps Sell All
**THEN** the entire stockpile is sold at the current price, the proceeds are added to money, and the container empties.

### 6. Auto-seller sells while online
**GIVEN** the game is online and an auto-seller is placed
**WHEN** an item is conveyed into the seller
**THEN** it is sold immediately at the item's current price and the money counter increases.

### 7. Money is formatted for large numbers
**GIVEN** the player's money reaches large magnitudes
**WHEN** the HUD displays it
**THEN** it is shown with abbreviated/named large-number formatting via `lib/format.ts`.

## Open Questions
- **MANUAL REVIEW:** When storage is at capacity, are further matching items rejected (back-pressure on the belt) or silently discarded? (Assumed: rejected / back-pressure.)
- **MANUAL REVIEW:** After Sell All empties a container, does it retain its locked type or unlock to accept a new type?
