/**
 * Playwright settings for the Electron e2e suites (serial, run on a fake brain).
 * A trace is kept only for a failed test, so a flaky CI failure can be replayed.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Electron launches are heavy and the single-instance lock means only one app can
  // run at a time, so the smoke suite is deliberately serial.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: process.env.CI ? 'list' : 'line',
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'retain-on-failure' },
});
