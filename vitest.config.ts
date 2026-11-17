import {defineConfig} from 'vitest/config';

/**
 * Sprint G9.2 (G2): reproducible test strategy.
 *
 * Root cause of the intermittent failures in G9.1: convex-test suites import and register the full Convex module graph
 * inside their first test. With 81 files running in parallel on Windows, that cold import alone can exceed Vitest's
 * default 5 s per-test timeout, so 2-4 different security suites timed out per run and passed in isolation.
 *
 * - The per-test and hook budget is raised to 30 s, which covers the cold import under full parallel load while still
 *   failing genuinely hung tests.
 * - `npm run test:serial` (vitest run --no-file-parallelism) is the deterministic fallback when a timeout must be
 *   distinguished from a real failure.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
