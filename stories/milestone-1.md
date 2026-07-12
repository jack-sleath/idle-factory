# Title: Scaffold + Canvas Sprite Pipeline + PWA Skeleton

<details>
<summary>Original Spec</summary>

## Milestone 1 — Scaffold + canvas sprite pipeline + PWA skeleton
**Goal:** A Vite/React/TS app that draws Twemoji sprites on a pannable canvas and installs as an offline PWA.

**Tasks:**
- Initialise Vite React-TS project; add Zustand; `tsconfig` strict; `vite.config.ts` with `base: '/idle-factory/'`.
- Vendor the Twemoji `14.0.2` SVGs we use into `public/twemoji/`; `lib/twemoji.ts` computes an emoji's codepoint filename → local SVG url (via `import.meta.env.BASE_URL`). Small DOM `<Emoji>` component for chrome.
- `render/sprites.ts` rasterizes an SVG to a cached bitmap; `render/camera.ts` + `render/renderer.ts` draw a few sprite tiles on a `<canvas>` in a rAF loop with pan (drag).
- Add `vite-plugin-pwa` with a web manifest (name, icons, theme color, `display: standalone`, `scope`/`start_url` under `/idle-factory/`) and a service worker that **precaches** the app shell + vendored SVGs.
- (Deploy workflow deferred to M11.)

**Done when:**
- [ ] `npm run dev` serves the app locally; `npm run build` succeeds under TS strict.
- [ ] The canvas draws Twemoji sprites that you can pan.
- [ ] The app is installable (manifest + service worker registered) and loads offline locally, with sprites still rendering.
</details>

## Technical Notes
- Vite + React 18 + TypeScript (strict); Zustand added as the state library.
- `vite.config.ts` sets `base: '/idle-factory/'`; all asset URLs derive from `import.meta.env.BASE_URL`.
- Twemoji 14.0.2 SVGs vendored under `public/twemoji/`; `lib/twemoji.ts` maps emoji → codepoint filename (no dependency on the global `twemoji` script).
- `render/sprites.ts` rasterizes SVG → cached bitmap; `render/renderer.ts` draws to `<canvas>` in a `requestAnimationFrame` loop; `render/camera.ts` holds pan/zoom.
- PWA via `vite-plugin-pwa` (Workbox): manifest + service worker precaching the app shell and vendored SVGs; `scope`/`start_url` under `/idle-factory/`.
- Live deploy is out of scope for this milestone (M11).

## Acceptance Criteria

### 1. Dev server runs and app loads
**GIVEN** a freshly cloned project with dependencies installed
**WHEN** the developer runs `npm run dev`
**THEN** the app is served locally and loads without console errors.

### 2. Production build succeeds under strict TypeScript
**GIVEN** the project source
**WHEN** the developer runs `npm run build`
**THEN** the build completes successfully with TypeScript strict mode enabled and no type errors.

### 3. Twemoji sprites render on the canvas
**GIVEN** the app is loaded in the browser
**WHEN** the canvas renders
**THEN** one or more Twemoji `14.0.2` sprites are drawn, sourced from the vendored local SVGs under the `/idle-factory/` base path.

### 4. Camera pans the canvas
**GIVEN** sprites are drawn on the canvas
**WHEN** the user drags across the canvas
**THEN** the view pans smoothly and the sprites move with the camera.

### 5. Installable, offline-capable PWA
**GIVEN** the app has been loaded once online with the service worker registered
**WHEN** the user installs it and then loads it with no network connection
**THEN** the app shell loads from cache and the vendored Twemoji sprites still render.

### 6. Assets resolve under the base path (negative path)
**GIVEN** the app is served under `/idle-factory/`
**WHEN** the page and its sprite assets load
**THEN** no asset returns a 404 due to a missing or incorrect base path.

## Open Questions
- **MANUAL REVIEW:** Which specific set of Twemoji SVGs must be vendored for this milestone (placeholder tiles vs. the full machine/item set)?
- **MANUAL REVIEW:** Are PWA icon assets (192/512/maskable) available, or should placeholders be generated for now?
