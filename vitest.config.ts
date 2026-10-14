import { defineConfig } from 'vitest/config';

// Floors for the host and the shared UI sit just below what they measure today, so CI
// passes now and fails the moment coverage drops. Raise them as coverage grows.
const desktopHostFloor = { statements: 52, branches: 57, functions: 43, lines: 52 };
const uiFloor = { statements: 92, branches: 85, functions: 91, lines: 94 };

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The pure packages carry the 70% bar. The desktop host (main process and
      // preload, not the renderer) and the shared UI carry a no-regression floor.
      include: [
        'packages/core/src/**/*.{ts,tsx}',
        'packages/protocol/src/**/*.{ts,tsx}',
        'packages/ui/src/**/*.{ts,tsx}',
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/preload/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/test-setup.ts'],
      thresholds: {
        'packages/core/src/**': { statements: 70, branches: 70, functions: 70, lines: 70 },
        'packages/protocol/src/**': { statements: 70, branches: 70, functions: 70, lines: 70 },
        'packages/ui/src/**': uiFloor,
        'apps/desktop/src/{main,preload}/**': desktopHostFloor,
      },
    },
  },
});
