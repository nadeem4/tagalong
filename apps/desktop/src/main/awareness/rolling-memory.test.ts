/**
 * Tests for rolling memory's ticks, exclusions and pause, and that awareness writes nothing to
 * disk.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { DisplaysCapture } from '../platform/displays';
import type { ActiveWindowInfo } from '../platform/index';
import { SightPausedError } from '../platform/sight-gate';
import { FakeClock } from './fake-clock';
import { FRAME_LONG_SIDE, ROLLING_TICK_MS, RollingMemory } from './rolling-memory';
import type { RollingMemoryPlatform } from './rolling-memory';

const EXCLUSIONS: CaptureExclusions = { processNames: ['KeePass.exe'], titlePatterns: [] };

function capture(): DisplaysCapture {
  return {
    displays: [
      {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1.5,
        primary: true,
        focused: true,
        blocked: null,
        image: { base64: Buffer.from('png-1').toString('base64'), width: 640, height: 360 },
      },
      {
        id: 2,
        bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
        scaleFactor: 1,
        primary: false,
        focused: false,
        blocked: { rule: 'processName', entry: 'KeePass.exe' },
        image: { base64: Buffer.from('blocked').toString('base64'), width: 640, height: 512 },
      },
    ],
    composite: null,
  };
}

function fakePlatform(active: ActiveWindowInfo | null = null) {
  const state = { active, paused: false };
  const platform: RollingMemoryPlatform & { calls: string[] } = {
    calls: [],
    getActiveWindow: vi.fn(() => {
      platform.calls.push('getActiveWindow');
      if (state.paused) return Promise.reject(new SightPausedError('getActiveWindow'));
      return Promise.resolve(state.active);
    }),
    captureDisplays: vi.fn((maxLongSide: number) => {
      platform.calls.push(`captureDisplays:${maxLongSide}`);
      return Promise.resolve(capture());
    }),
    listWindows: vi.fn(() => {
      platform.calls.push('listWindows');
      return Promise.resolve({
        windows: [
          {
            id: 'w1',
            processName: 'Code.exe',
            title: 'notes.md',
            state: 'foreground' as const,
            browser: false,
          },
        ],
      });
    }),
  };
  return { platform, state };
}

function setup(options: { active?: ActiveWindowInfo | null } = {}) {
  const clock = new FakeClock(1_000_000);
  const { platform, state } = fakePlatform(options.active ?? null);
  const recordingChanges: boolean[] = [];
  const memory = new RollingMemory({
    platform,
    clock,
    exclusions: () => EXCLUSIONS,
    isPaused: () => state.paused,
    onRecordingChange: (recording) => recordingChanges.push(recording),
  });
  return { clock, platform, state, memory, recordingChanges };
}

describe('RollingMemory', () => {
  it('records nothing until it is turned on: it is opt-in', async () => {
    const { clock, platform, memory } = setup();
    await clock.advance(60_000);
    expect(platform.calls).toEqual([]);
    expect(memory.recording).toBe(false);
  });

  it('captures every display at 640 pixels and the window list every five seconds', async () => {
    const { clock, platform, memory, recordingChanges } = setup();
    memory.configure({ enabled: true, minutes: 10 });
    expect(recordingChanges).toEqual([true]);

    await clock.advance(ROLLING_TICK_MS);
    expect(platform.calls).toContain(`captureDisplays:${FRAME_LONG_SIDE}`);
    expect(memory.ring.size).toBe(1);

    const moment = memory.ring.newest()!;
    expect(moment.at).toBe(1_000_000 + ROLLING_TICK_MS);
    expect(moment.windows.map((window) => window.id)).toEqual(['w1']);
    // The blocked display's placeholder is not a memory of anything.
    expect(moment.frames.map((frame) => frame.displayId)).toEqual([1]);
    expect(moment.frames[0]).toMatchObject({ displayWidth: 2880, displayHeight: 1620 });

    await clock.advance(ROLLING_TICK_MS * 3);
    expect(memory.ring.size).toBe(4);
  });

  it('evicts beyond the configured minutes', async () => {
    const { clock, memory } = setup();
    memory.configure({ enabled: true, minutes: 1 });
    await clock.advance(5 * 60_000);
    // One minute at one frame every five seconds, plus the frame on the boundary.
    expect(memory.ring.size).toBe(13);
    expect(memory.ring.newest()!.at - memory.ring.oldest()!.at).toBe(60_000);
  });

  it('skips a frame while an excluded app is focused', async () => {
    const { clock, platform, memory } = setup({
      active: {
        appName: 'KeePass.exe',
        title: 'vault',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    });
    memory.configure({ enabled: true, minutes: 10 });
    await clock.advance(ROLLING_TICK_MS * 2);
    expect(memory.ring.size).toBe(0);
    // Refused before the picture was taken, not filtered after.
    expect(platform.calls.some((call) => call.startsWith('captureDisplays'))).toBe(false);
  });

  it('stops while sight is paused, clears what it held, and resumes after', async () => {
    const { clock, memory, state, recordingChanges } = setup();
    memory.configure({ enabled: true, minutes: 10 });
    await clock.advance(ROLLING_TICK_MS * 2);
    expect(memory.ring.size).toBe(2);

    state.paused = true;
    memory.pauseChanged(true);
    expect(memory.recording).toBe(false);
    expect(memory.ring.size).toBe(0);
    await clock.advance(ROLLING_TICK_MS * 2);
    expect(memory.ring.size).toBe(0);

    state.paused = false;
    memory.pauseChanged(false);
    await clock.advance(ROLLING_TICK_MS);
    expect(memory.ring.size).toBe(1);
    expect(recordingChanges).toEqual([true, false, true]);
  });

  it('turning it off clears the buffer and stops the timer', async () => {
    const { clock, platform, memory, recordingChanges } = setup();
    memory.configure({ enabled: true, minutes: 10 });
    await clock.advance(ROLLING_TICK_MS);
    memory.configure({ enabled: false, minutes: 10 });
    expect(memory.ring.size).toBe(0);
    const calls = platform.calls.length;
    await clock.advance(ROLLING_TICK_MS * 4);
    expect(platform.calls.length).toBe(calls);
    expect(recordingChanges).toEqual([true, false]);
  });

  it('changing the minutes keeps recording and trims at once', async () => {
    const { clock, memory, recordingChanges } = setup();
    memory.configure({ enabled: true, minutes: 10 });
    await clock.advance(3 * 60_000);
    memory.configure({ enabled: true, minutes: 1 });
    expect(memory.ring.size).toBe(13);
    expect(recordingChanges).toEqual([true]);
  });

  it('clears on quit', async () => {
    const { clock, memory } = setup();
    memory.configure({ enabled: true, minutes: 10 });
    await clock.advance(ROLLING_TICK_MS * 3);
    memory.dispose();
    expect(memory.ring.size).toBe(0);
    expect(memory.recording).toBe(false);
    expect(clock.pendingTimers).toBe(0);
  });
});

describe('the awareness folder', () => {
  it('never touches disk: no module here imports fs', () => {
    const folder = import.meta.dirname;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const source = readFileSync(join(folder, name), 'utf8');
      expect(source, name).not.toMatch(/from ['"](node:)?fs(\/promises)?['"]/);
    }
  });
});
