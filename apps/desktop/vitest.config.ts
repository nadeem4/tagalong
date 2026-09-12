import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@tagalong/desktop',
    // Tests run in plain Node, never inside Electron: anything that needs a display or
    // a real keyboard is injected as a fake instead.
    environment: 'node',
    // e2e/ belongs to Playwright, which launches a real Electron app. Vitest's default
    // glob matches *.spec.ts too, so without this it collects the smoke test and fails
    // on Playwright's own runner guard rather than on anything real.
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'e2e/**'],
  },
});
