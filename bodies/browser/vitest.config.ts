/** Vitest config for the extension. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@tagalong/browser',
    // Node by default. Nothing here touches a real Chrome: every chrome.* surface is reached
    // through an injected fake.
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
  },
});
