# Title: Offline Idle Progression

<details>
<summary>Original Spec</summary>

## Milestone 9 — Offline idle progression
**Goal:** The factory stockpiles goods while the tab/browser is closed, without selling.

**Tasks:**
- Trigger on `visibilitychange → visible`; on `→ hidden` persist state + `savedAt`.
- `elapsed = min(now - savedAt, maxOfflineHours)` clamped ≥ 0; the same capped value drives **both** market catch-up and production.
- Advance the market by `elapsed`.
- With the `online` flag off (sellers buffer instead of sell), sample the pure tick step headlessly for `offlineSampleSeconds` (default ~60s, after a warm-up) to measure each accumulator's intake per item type — **storage** and **auto-sellers**.
- Extrapolate over `elapsed`: storage gains `ratePerMs × elapsed` **clamped to remaining capacity**; each auto-seller's buffer is then **sold once at the caught-up current price**, crediting money.
- **Clear in-flight items off belts** (items in transit disappear across the skip).
- Present an away summary: elapsed time, items stockpiled, and money auto-earned.

**Done when:**
- [ ] Returning advances market + stockpiles under a single 24h cap on both; storage never exceeds capacity.
- [ ] Auto-sellers sell their buffer once at the caught-up price; no money is credited at fluctuating offline prices.
- [ ] In-flight belt items are cleared across the skip; the away summary shows stockpiles + earnings.
- [ ] Catch-up is near-instant even after a full-day absence (samples a short window, does not replay a day of ticks).
</details>

## Technical Notes
- Trigger on `visibilitychange → visible`; state + `savedAt` persisted on `→ hidden`.
- `elapsed = min(now - savedAt, maxOfflineHours)` clamped ≥ 0; the same capped value drives both market catch-up and production.
- Market is advanced by `elapsed`.
- With `online` off (sellers buffer rather than sell), the pure tick step is sampled headlessly for `offlineSampleSeconds` (~60s, after a warm-up) to measure per-item intake for storage and auto-sellers.
- Extrapolation: storage gains `ratePerMs × elapsed` clamped to remaining capacity; each auto-seller buffer is sold once at the caught-up current price.
- In-flight belt items are cleared across the skip; `savedAt` is reset to now.
- Away summary reports elapsed time, items stockpiled, and money auto-earned.

## Acceptance Criteria

### 1. Returning advances market and stockpiles under a shared cap
**GIVEN** the game was closed and reopened after some elapsed time
**WHEN** the app becomes visible
**THEN** the market and production both advance by the same `elapsed`, capped at `maxOfflineHours` (default 24h).

### 2. Storage never exceeds capacity during catch-up
**GIVEN** offline extrapolation for a storage container
**WHEN** the projected intake would exceed remaining capacity
**THEN** the container is clamped to its capacity and does not overflow.

### 3. Auto-sellers sell their buffer once at the caught-up price
**GIVEN** auto-sellers that buffered items while offline
**WHEN** catch-up runs
**THEN** each seller's buffer is sold exactly once at the caught-up current price, crediting money.

### 4. No sales occur at fluctuating offline prices (negative path)
**GIVEN** the offline period during which prices changed
**WHEN** catch-up runs
**THEN** no money is credited at intermediate offline prices — only the single caught-up price is used.

### 5. In-flight belt items are cleared
**GIVEN** items in transit on belts when the game closed
**WHEN** catch-up runs
**THEN** those in-flight items are cleared and do not appear on return.

### 6. Away summary is presented
**GIVEN** a completed catch-up
**WHEN** the app returns to the foreground
**THEN** an away summary shows elapsed time, items stockpiled in storage, and money auto-earned from seller buffers.

### 7. Catch-up is near-instant after a long absence
**GIVEN** a full 24h (capped) absence
**WHEN** catch-up runs
**THEN** it completes near-instantly by sampling a short window and extrapolating, not by replaying a day of ticks.

## Open Questions
- **MANUAL REVIEW:** Confirm defaults for `maxOfflineHours` (24h), `offlineSampleSeconds` (~60s), and the warm-up length.
- **MANUAL REVIEW:** If the sampled intake rate is zero (empty/blocked factory), should the away summary still be shown?
