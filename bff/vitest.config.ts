import { defineConfig } from 'vitest/config';

// Vitest config for the BFF unit suite (test infrastructure, not implementation).
// `setupFiles` seeds the required env vars (config.ts / store/db.ts throw / open a file at
// import time) BEFORE any test file's own static imports are evaluated.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
