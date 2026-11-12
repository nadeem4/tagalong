/* Test config for the mascot engine: pure logic only, run in node with no WebGL. */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@tagalong/mascot', environment: 'node', include: ['src/**/*.test.ts'] },
});
