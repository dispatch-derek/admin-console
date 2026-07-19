import { defineConfig } from 'vitest/config';

// E2E harness for the F-004 outbox relay (bff/src/relay/**). Separate package/runner from the
// bff `vitest.config.ts` unit suite AND from the root `tests/e2e` Playwright (web) suite -- this
// one spawns the relay as a REAL child process (real DB file, real localhost HTTP), so it is slow
// and must never run inside the fast unit loop. `fileParallelism: false` keeps relay child
// processes / ephemeral ports from colliding across concurrently-running test files; within a
// file, tests already run sequentially (no `describe.concurrent`).
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
