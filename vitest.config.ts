import { defineConfig } from 'vitest/config';

// Root config: runs the entire unit-test suite across workspaces
// (shared money/date utils + server-side pure logic: running balance,
// budget rollup, import match/dedupe, history period bucketing).
export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts', 'server/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Integration tests share module-level DB singletons per file; run files in
    // isolation (separate module registry) so each gets its own temp database.
    isolate: true,
    pool: 'forks',
  },
});
