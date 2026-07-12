# Title: Stock Market

<details>
<summary>Original Spec</summary>

## Milestone 7 — Stock market
**Goal:** Item prices fluctuate on a configurable cadence, are graphed, persist, and drive selling.

**Tasks:**
- Seed each price from the item's starting value; every `marketIntervalMinutes`, multiply the price by a **geometrically neutral** factor `exp((rand()*2−1)·ln(1+volatility))` (→ ×[1/1.2, 1.2] at volatility 0.2, log-symmetric so there is no long-run drift).
- Keep a rolling **last-10-values** history per item and draw a per-item SVG sparkline (with the last-update time / 10-value window) in a market panel.
- If a price reaches its `minPrice` or `maxPrice`, the item **crashes and resets to its starting value**.
- Sellers and storage **Sell All** use the live price.

**Done when:**
- [ ] Each interval multiplies prices by a neutral factor (verified: no systematic up/down drift over many steps).
- [ ] Hitting `minPrice` or `maxPrice` resets the item to its starting value.
- [ ] The market panel shows a graph of each item's last 10 values.
- [ ] Market state (including histories) persists across reload and is included in export/import.
- [ ] Sellers and Sell-All use the live price.
</details>

## Technical Notes
- Each item's price is seeded from its starting value; every `marketIntervalMinutes` it is multiplied by `exp((rand()*2−1)·ln(1+volatility))` — log-symmetric, so ×[1/(1+vol), (1+vol)] with no long-run drift (default volatility 0.2 → ×[1/1.2, 1.2]).
- Crash rule: when a price reaches `minPrice` or `maxPrice`, the item resets to its starting value.
- A rolling last-10-values history is kept per item and rendered as a lightweight inline SVG sparkline in the market panel.
- Market state (current prices, last-update time, per-item histories) is persisted in the save and included in export/import.
- Auto-sellers and storage Sell All read the live price.

## Acceptance Criteria

### 1. Prices update each interval with no drift
**GIVEN** the market is running
**WHEN** each `marketIntervalMinutes` interval elapses
**THEN** every price is multiplied by the neutral random factor in ×[1/1.2, 1.2], and over many steps there is no systematic upward or downward drift.

### 2. Price crash resets to starting value
**GIVEN** an item whose fluctuating price reaches its `minPrice` or `maxPrice`
**WHEN** that bound is hit
**THEN** the item crashes and its price resets to its configured starting value.

### 3. Market panel graphs each item's last 10 values
**GIVEN** items with recorded price history
**WHEN** the user opens the market panel
**THEN** each item shows an SVG sparkline of its last 10 values.

### 4. Market state persists across reload
**GIVEN** a running market with price history
**WHEN** the tab is reloaded
**THEN** current prices, last-update time, and per-item histories are restored.

### 5. Market state is included in export/import
**GIVEN** a saved game with market state
**WHEN** the player exports and re-imports the save
**THEN** the market prices and histories are fully restored.

### 6. Sellers and Sell All use the live price
**GIVEN** an item with a fluctuating price
**WHEN** an auto-seller sells it or a storage Sell All is triggered
**THEN** the transaction uses the item's current live market price.

## Open Questions
- **MANUAL REVIEW:** Is the market deterministic given a save (seeded RNG for reproducibility), or freshly random each session?
- **MANUAL REVIEW:** Confirm defaults for `marketIntervalMinutes` and `volatility` (spec implies volatility 0.2 → ×[1/1.2, 1.2]).
