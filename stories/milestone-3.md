# Title: Tick Engine, Belts & Spawners

<details>
<summary>Original Spec</summary>

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
- [ ] A packed belt advances as a unit when the head clears; a blocked belt applies back-pressure without duplicating or dropping items.
</details>

## Technical Notes
- Tick step is a pure `state → state` function using a next-state buffer (no in-place mutation), so it can run headlessly for offline catch-up (M9).
- Live play is driven by a single monotonic tick counter at `tickMs`; rendering is throttled/decoupled from the simulation step.
- Belt movement uses a pull model over the sparse world: an empty cell pulls from the upstream neighbour whose output points into it.
- Fixed source priority N,E,S,W deterministically resolves contention when two belts feed one cell.
- Each item moves at most one cell and acts at most once per tick; packed belts advance as a unit.
- Items are rendered as sprites layered on top of belt cells.

## Acceptance Criteria

### 1. Spawner emits on its interval
**GIVEN** a spawner with a free output cell
**WHEN** the configured number of ticks elapses
**THEN** the spawner emits one configured raw item into its output cell.

### 2. Item travels one cell per tick along a belt
**GIVEN** a spawner → belt → belt chain
**WHEN** the simulation advances one tick
**THEN** the item moves exactly one cell downstream in the belts' output direction.

### 3. Packed belt advances as a unit
**GIVEN** a fully packed run of belts whose head cell then becomes free
**WHEN** the simulation advances one tick
**THEN** every item in the run advances one cell together, with no gaps opening mid-run.

### 4. Blocked belt applies back-pressure (negative path)
**GIVEN** a belt chain whose downstream destination is occupied
**WHEN** the simulation advances
**THEN** upstream items hold in place and no item is duplicated or dropped.

### 5. Merge resolves deterministically
**GIVEN** two belts whose outputs both point into the same empty cell
**WHEN** the simulation advances one tick
**THEN** exactly one item enters that cell, chosen by fixed N,E,S,W priority, and the losing source's item holds.

### 6. Spawner holds when output is occupied (negative path)
**GIVEN** a spawner whose output cell is occupied
**WHEN** the spawner's interval elapses
**THEN** it does not emit and no item is lost; it emits on the next interval once the cell is free.

### 7. Each item acts at most once per tick
**GIVEN** a moving item on a belt
**WHEN** the simulation advances one tick
**THEN** the item advances at most one cell (it does not "leapfrog" multiple cells within a single tick).

## Open Questions
- **MANUAL REVIEW:** What is the default `tickMs`, and should rendering interpolate item positions between ticks or snap per tick?
- **MANUAL REVIEW:** When a merge is resolved by N,E,S,W priority, is the losing source's item held (back-pressure) as assumed, or dropped?
