/** Vitest config for the WhatsApp bridge: node only, every network edge is an injected fake. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@tagalong/whatsapp',
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
  },
});
