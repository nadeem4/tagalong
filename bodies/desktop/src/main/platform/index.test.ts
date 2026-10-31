/** Tests for createPlatform. */

import { describe, expect, it, vi } from 'vitest';
import { createPlatform } from './index';
import { runPowerShellScript } from './powershell';

// win32.ts reaches for Electron's clipboard at import time. get-windows and nut-js are
// loaded lazily inside the methods, so no native addon is touched by this test.
vi.mock('electron', () => ({
  clipboard: { readText: async () => '', writeText: async () => {} },
}));

vi.mock('./powershell', () => ({ runPowerShellScript: vi.fn(async () => '') }));

describe('createPlatform', () => {
  it('builds the win32 adapter on Windows', () => {
    const platform = createPlatform('win32');

    expect(typeof platform.captureSelection).toBe('function');
    expect(typeof platform.getActiveWindow).toBe('function');
  });

  it('names the platform it cannot run on rather than returning a stub', () => {
    expect(() => createPlatform('darwin')).toThrow(/darwin/);
    expect(() => createPlatform('linux')).toThrow(/Windows only/);
  });

  it('gives the window list 8 s, so a cold PowerShell start fits inside the 15 s tool cap', async () => {
    await createPlatform('win32').listWindows({ processNames: [], titlePatterns: [] });

    expect(vi.mocked(runPowerShellScript).mock.calls[0]?.[1]).toBe(8_000);
  });
});
