# Title: Sparse World, Camera, Placement & Persistence

<details>
<summary>Original Spec</summary>

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
</details>

## Technical Notes
- Sparse world in the Zustand store: `Map<"x,y", Machine>` (signed integer coords) + a parallel items map, with a chunk index for viewport culling.
- Config data files: `data/config.ts` (no grid size), `items.json`, `recipes.json`, `catalog.json`; shared types in `game/types.ts`.
- Camera supports pan and zoom; a helper maps screen pointer coordinates → world cell.
- Palette build tools are generated from the catalog (incl. multiple spawner variants) plus Select / Rotate / Delete; the active tool determines the tap action.
- Placement is free in this milestone (cost enforcement lands in M6).
- Debounced autosave to `localStorage`; state + `savedAt` persisted on `visibilitychange → hidden`; restored on load.

## Acceptance Criteria

### 1. Pan and zoom the world
**GIVEN** the game world is displayed
**WHEN** the user drags to pan and pinches/scrolls to zoom
**THEN** the camera moves and scales, and only the visible region is drawn.

### 2. Place any machine kind
**GIVEN** a build tool is selected from the palette
**WHEN** the user taps an empty cell
**THEN** a machine of that kind is placed at that cell in its default orientation and drawn with the correct sprite.

### 3. Rotate a placed machine
**GIVEN** the Rotate tool is selected
**WHEN** the user taps an existing machine
**THEN** the machine's orientation cycles 90° and its sprite updates to reflect the new facing.

### 4. Delete a placed machine
**GIVEN** the Delete tool is selected
**WHEN** the user taps an existing machine
**THEN** the machine is removed from the world.

### 5. New game seeds the starter kit
**GIVEN** no existing save
**WHEN** a new game starts
**THEN** the world contains a pre-placed basic ore gatherer feeding one conveyor into one basic storage.

### 6. Layout persists across reload
**GIVEN** the user has placed and arranged machines
**WHEN** the tab is hidden and then the page is reloaded
**THEN** the exact machine layout, orientations, and camera state are restored from `localStorage`.

### 7. Select tool does not place or delete (negative path)
**GIVEN** the Select tool is active
**WHEN** the user taps an empty cell or an existing machine
**THEN** no machine is placed or removed by that tap.

## Open Questions
- **MANUAL REVIEW:** Should tapping an empty cell with a build tool over an already-occupied cell be a no-op, or replace the existing machine? (Default assumed: no-op / placement requires an empty cell.)
- **MANUAL REVIEW:** Confirm the exact camera zoom range and whether world coordinates need a soft bound to avoid float-precision issues.
