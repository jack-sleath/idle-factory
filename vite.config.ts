import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served at the root of the custom domain auto-exportica.jack-sleath.dev
// (see public/CNAME), so the base path is '/'. All runtime asset URLs derive
// from import.meta.env.BASE_URL, which Vite populates from this `base` value.
const BASE = '/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [
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
        name: 'Idle Factory',
        short_name: 'IdleFactory',
        description: 'A browser idle/incremental factory game built with emoji sprites.',
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
