# Title: Deploy to GitHub Pages

<details>
<summary>Original Spec</summary>

## Milestone 11 — Deploy to GitHub Pages
**Goal:** Ship the app live and installable.

**Tasks:**
- `.github/workflows/deploy.yml`: build → upload Pages artifact → deploy, with `permissions: pages: write, id-token: write`.
- Set the repo's Pages source to "GitHub Actions".
- Verify assets, service worker scope, and manifest `start_url` all resolve under `/idle-factory/`.

**Done when:**
- [ ] `https://jack-sleath.github.io/idle-factory/` loads, installs as a PWA, and runs offline.
</details>

## Technical Notes
- `.github/workflows/deploy.yml`: build → upload Pages artifact → deploy; `permissions: pages: write, id-token: write`.
- Repo Pages source set to "GitHub Actions".
- Assets, service worker scope, and manifest `start_url` must all resolve under the `/idle-factory/` base path.

## Acceptance Criteria

### 1. CI builds and deploys to Pages
**GIVEN** the deploy workflow is configured with the correct permissions
**WHEN** the workflow runs
**THEN** the app builds, uploads the Pages artifact, and deploys without errors.

### 2. Live site loads under the base path
**GIVEN** a successful deploy
**WHEN** a user visits `https://jack-sleath.github.io/idle-factory/`
**THEN** the app loads correctly.

### 3. Installable as a PWA from the live site
**GIVEN** the live site loaded over HTTPS
**WHEN** the user installs it
**THEN** it installs as a PWA (manifest + service worker registered) with `start_url` under `/idle-factory/`.

### 4. Runs offline from the live site
**GIVEN** the live PWA has been loaded once
**WHEN** the user reopens it with no network connection
**THEN** the app shell and vendored Twemoji sprites load from cache and the game runs.

### 5. No base-path 404s (negative path)
**GIVEN** the deployed site under `/idle-factory/`
**WHEN** its assets, service worker, and manifest load
**THEN** none returns a 404 due to an incorrect base path or scope.

## Open Questions
- **MANUAL REVIEW:** Which trigger should deploy (push to `main`, tag, and/or manual dispatch)?
- **MANUAL REVIEW:** Is a custom domain in scope, or only the default `github.io` project URL?
