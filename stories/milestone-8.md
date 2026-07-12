# Title: Save Management (Export / Import)

<details>
<summary>Original Spec</summary>

## Milestone 8 — Save management (export / import)
**Goal:** Manual, portable saves.

**Tasks:**
- Manual Save/Load buttons.
- Export downloads `idle-factory-save.json`.
- Import reads an uploaded file and restores state.
- Versioned save schema with a version field.

**Done when:**
- [ ] Export produces a valid JSON save file.
- [ ] Import fully restores the game state from a file.
</details>

## Technical Notes
- Manual Save/Load buttons alongside the existing autosave.
- Export downloads the current save as `idle-factory-save.json`.
- Import reads an uploaded JSON file and restores the full game state.
- Save schema carries a version field to allow future migration.

## Acceptance Criteria

### 1. Export produces a valid save file
**GIVEN** an in-progress game
**WHEN** the user clicks Export
**THEN** a valid JSON file named `idle-factory-save.json` is downloaded containing the full game state.

### 2. Import restores game state from a file
**GIVEN** a previously exported save file
**WHEN** the user imports it
**THEN** the game state (world, money, market, camera) is fully restored to match the saved state.

### 3. Save includes a schema version
**GIVEN** an exported save file
**WHEN** its contents are inspected
**THEN** it contains a schema version field.

### 4. Manual Save and Load round-trip
**GIVEN** an in-progress game
**WHEN** the user clicks Save and later Load
**THEN** the loaded state matches the state at the time of saving.

### 5. Invalid import is handled gracefully (negative path)
**GIVEN** a malformed or non-save JSON file
**WHEN** the user attempts to import it
**THEN** the import is rejected with a clear error and the current game state is left unchanged.

## Open Questions
- **MANUAL REVIEW:** How should importing a save with a mismatched/older schema version be handled — migrate, reject, or warn?
- **MANUAL REVIEW:** Should Import prompt for confirmation before overwriting the current in-progress game?
