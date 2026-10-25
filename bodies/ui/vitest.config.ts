import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@tagalong/ui',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // jsdom role queries are CPU-bound: a full Home render or a 35-row list takes about 1.5s
    // alone and several times that on a loaded CI runner, past the 5s default.
    testTimeout: 20_000,
  },
});
