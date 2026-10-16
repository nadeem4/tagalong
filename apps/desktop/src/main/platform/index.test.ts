/** Tests for createPlatform. */

import { describe, expect, it, vi } from 'vitest';
import { createPlatform } from './index';

// win32.ts reaches for Electron's clipboard at import time. get-windows and nut-js are
// loaded lazily inside the methods, so no native addon is touched by this test.
vi.mock('electron', () => ({
  clipboard: { readText: async () => '', writeText: async () => {} },
}));

describe('createPlatform', () => {
  it('builds the win32 adapter on Windows', () => {
    const platform = createPlatform('win32');

    expect(typeof platform.captureSelection).toBe('function');
    expect(typeof platform.getActiveWindow).toBe('function');
    expect(typeof platform.readClipboard).toBe('function');
  });

  it('says which phase brings the other platforms rather than returning a stub', () => {
    expect(() => createPlatform('darwin')).toThrow(/darwin/);
    expect(() => createPlatform('linux')).toThrow(/Phase 7/);
  });

  it('exposes window capture now that Phase 2 has landed', () => {
    // What capture actually does is covered in capture.test.ts against injected fakes;
    // calling it here would reach Electron's real capturer and need a display.
    expect(typeof createPlatform('win32').captureActiveWindowImage).toBe('function');
  });
});
