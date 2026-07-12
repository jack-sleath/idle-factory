# Title: Google Drive Sync (Deferred)

<details>
<summary>Original Spec</summary>

## Milestone 12 (deferred) — Google Drive sync
**Goal:** Optional cloud save/load via Google Drive.

**Tasks:**
- OAuth via Google Identity Services; Client ID as a config value.
- Save/load the JSON save to Drive (`appDataFolder`).
- Connect/disconnect UI.

**Done when:**
- [ ] After authorizing, the player can save and load from Google Drive on the live Pages site.
</details>

## Technical Notes
- This milestone is **deferred** (post-MVP / out of scope for the core game).
- OAuth via Google Identity Services; the Client ID is a config value.
- Save/load the JSON save to the Drive `appDataFolder`.
- Connect/disconnect UI to manage the Drive link.

## Acceptance Criteria

### 1. Authorize Google Drive
**GIVEN** the player has not connected Drive
**WHEN** they choose Connect and complete the Google OAuth flow
**THEN** the app is authorized to use the player's Drive `appDataFolder`.

### 2. Save to Drive
**GIVEN** a connected Drive account
**WHEN** the player saves to Drive
**THEN** the JSON save is written to the Drive `appDataFolder`.

### 3. Load from Drive
**GIVEN** a save exists in the player's Drive `appDataFolder`
**WHEN** the player loads from Drive
**THEN** the game state is restored from that save.

### 4. Disconnect Drive
**GIVEN** a connected Drive account
**WHEN** the player chooses Disconnect
**THEN** the connection is cleared and no further Drive save/load occurs until reconnected.

### 5. Works on the live Pages site
**GIVEN** the deployed app at `https://jack-sleath.github.io/idle-factory/`
**WHEN** the player authorizes and uses Drive save/load
**THEN** it functions on the live site.

### 6. Core game works without connecting (negative path)
**GIVEN** the player never connects Drive
**WHEN** they play the game
**THEN** the core game works fully via `localStorage` with no account required.

## Open Questions
- **MANUAL REVIEW:** How are the OAuth Client ID and consent-screen configuration provisioned for the Pages origin?
- **MANUAL REVIEW:** On a conflict between a newer local save and a Drive save, which wins — newest `savedAt`, or an explicit user choice?
