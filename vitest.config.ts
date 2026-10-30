import { defineConfig } from 'vitest/config';

// Floors for the host and the shared UI sit just below what they measure today, so CI
// passes now and fails the moment coverage drops. Raise them as coverage grows.
const desktopHostFloor = { statements: 59, branches: 62, functions: 49, lines: 60 };
// The ui floor dropped when the crew UI went: the deleted crew strip, pet avatar and furniture
// were fully covered, and the crew tests also covered chat-panel and message-list paths.
const uiFloor = { statements: 91, branches: 83, functions: 90, lines: 93 };

export default defineConfig({
  test: {
    projects: ['bodies/*', 'protocol/ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The pure contract package carries the 70% bar. The desktop host (main process and
      // preload, not the renderer) and the shared UI carry a no-regression floor.
      include: [
        'protocol/ts/src/**/*.ts',
        'bodies/ui/src/**/*.{ts,tsx}',
        'bodies/desktop/src/main/**/*.ts',
        'bodies/desktop/src/preload/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/test-setup.ts'],
      thresholds: {
        'protocol/ts/src/**': { statements: 70, branches: 70, functions: 70, lines: 70 },
        'bodies/ui/src/**': uiFloor,
        'bodies/desktop/src/{main,preload}/**': desktopHostFloor,
      },
    },
  },
});
