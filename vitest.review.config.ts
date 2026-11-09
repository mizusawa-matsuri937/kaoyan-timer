import { defineConfig } from 'vitest/config'

// Isolated audit suite: failed assertions describe bugs, not expected failures.
// No browser profile, real IndexedDB data, or GitHub credentials are used.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'review/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
