# Title: Mobile & Polish Pass

<details>
<summary>Original Spec</summary>

## Milestone 10 — Mobile & polish pass
**Goal:** Comfortable one-handed mobile play.

**Tasks:**
- Touch ergonomics; distinguish camera gestures (pan/pinch-zoom) from placement taps; large tap targets.
- Number-formatting polish; onboarding hint.

**Done when:**
- [ ] The game is comfortably playable one-handed on a phone.
- [ ] Camera gestures and placement taps don't interfere with each other.
</details>

## Technical Notes
- Touch ergonomics tuned for one-handed play; large tap targets.
- Camera gestures (pan, pinch-zoom) are distinguished from placement taps so they don't trigger each other.
- Number-formatting polish across the HUD/panels; an onboarding hint for new players.

## Acceptance Criteria

### 1. One-handed mobile play
**GIVEN** the game running in a phone browser
**WHEN** the player interacts one-handed
**THEN** the layout is responsive and controls/tap targets are comfortably reachable and large enough to hit reliably.

### 2. Panning does not place a machine (negative path)
**GIVEN** a build tool is active
**WHEN** the player drags to pan the camera
**THEN** the camera pans and no machine is placed.

### 3. Pinch-zoom does not place a machine (negative path)
**GIVEN** a build tool is active
**WHEN** the player pinches to zoom
**THEN** the view zooms and no machine is placed.

### 4. A tap performs the tool action without moving the camera
**GIVEN** a tool is active
**WHEN** the player taps a cell (without dragging)
**THEN** the tool's action fires (place/select/rotate/delete) and the camera does not move.

### 5. Onboarding hint for new players
**GIVEN** a new player starting the game
**WHEN** the game first loads
**THEN** an onboarding hint is shown explaining the basic controls.

### 6. Polished number formatting
**GIVEN** money and values displayed across the UI
**WHEN** they are rendered
**THEN** large numbers use consistent, polished abbreviated formatting.

## Open Questions
- **MANUAL REVIEW:** What threshold (movement distance / press duration) distinguishes a tap from the start of a pan gesture?
- **MANUAL REVIEW:** Should the onboarding hint be dismissible and shown only once (persisted), or shown on every new game?
