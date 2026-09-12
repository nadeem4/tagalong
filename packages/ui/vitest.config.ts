import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@tagalong/ui',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
