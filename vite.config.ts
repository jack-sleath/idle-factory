import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { assertDataValid } from './src/data/validate'

// Fail the build (and dev server startup) if the content JSON has a broken
// reference — a recipe/spawner pointing at an item id that doesn't exist, a
// missing junk item, etc. This turns previously-silent data typos into a loud
// error. See src/data/validate.ts.
function validateGameData(): Plugin {
  return {
    name: 'validate-game-data',
    buildStart() {
      assertDataValid()
    },
  }
}

// Served at the root of the custom domain auto-exportica.jack-sleath.dev
// (see public/CNAME), so the base path is '/'. All runtime asset URLs derive
// from import.meta.env.BASE_URL, which Vite populates from this `base` value.
const BASE = '/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [
    validateGameData(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Precache the vendored Twemoji SVGs alongside the app shell so the
      // game and its emoji render with no network connection.
      includeAssets: ['favicon.svg', 'twemoji/*.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2,json}'],
      },
      manifest: {
        name: 'Auto-Exportica',
        short_name: 'Exportica',
        description: 'An idle factory game. You alone can make it happen.',
        theme_color: '#f0b429',
        background_color: '#1f2933',
        display: 'standalone',
        orientation: 'portrait',
        // scope and start_url follow Vite `base` ('/' on the custom domain);
        // set explicitly for clarity.
        scope: BASE,
        start_url: BASE,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
