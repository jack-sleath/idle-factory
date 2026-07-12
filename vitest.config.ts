import { defineConfig } from 'vitest/config'

// Unit tests for the pure game logic and store. jsdom provides localStorage and
// crypto for persistence/id tests. The PWA/React plugins aren't needed here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
