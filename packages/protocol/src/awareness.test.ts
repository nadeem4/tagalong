/** Tests for perception.recall, perception.diff and the watch notifications. */
import { describe, expect, it } from 'vitest';
import {
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  WatchFiredParams,
  WatchStatusParams,
  WatchStopParams,
  WatchStopResult,
} from './awareness';
import {
  HostCapability,
  coreToHostMethods,
  coreToHostNotifications,
  hostToCoreMethods,
} from './methods';

const watchId = '11111111-2222-4333-8444-555555555555';
const image = { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 640, height: 360 } as const;

describe('perception.recall', () => {
  it('accepts a number of seconds ago with or without a display', () => {
    expect(PerceptionRecallParams.safeParse({ secondsAgo: 300 }).success).toBe(true);
    expect(PerceptionRecallParams.safeParse({ secondsAgo: 0, displayId: 2 }).success).toBe(true);
  });

  it('refuses a negative or fractional time', () => {
    expect(PerceptionRecallParams.safeParse({ secondsAgo: -5 }).success).toBe(false);
    expect(PerceptionRecallParams.safeParse({ secondsAgo: 1.5 }).success).toBe(false);
    expect(PerceptionRecallParams.safeParse({}).success).toBe(false);
  });

  it('carries the frame, its timestamp and the window list of that moment', () => {
    const result = PerceptionRecallResult.parse({
      recording: true,
      oldestAt: '2026-10-04T10:00:00.000Z',
      capturedAt: '2026-10-04T10:05:00.000Z',
      frames: [{ displayId: 1, capturedAt: '2026-10-04T10:05:00.000Z', image }],
      windows: [
        {
          id: 'w1',
          processName: 'Code.exe',
          title: 'README.md',
          state: 'foreground',
          browser: false,
        },
      ],
      focusedWindow: { processName: 'Code.exe', title: 'README.md' },
    });
    expect(result.frames[0]?.capturedAt).toBe('2026-10-04T10:05:00.000Z');
  });

  it('allows an empty buffer, which is what a recall after a restart gets', () => {
    expect(
      PerceptionRecallResult.safeParse({ recording: false, frames: [], windows: [] }).success,
    ).toBe(true);
  });

  it('refuses a frame without its timestamp', () => {
    const bad = { recording: true, frames: [{ displayId: 1, image }], windows: [] };
    expect(PerceptionRecallResult.safeParse(bad).success).toBe(false);
  });
});

describe('perception.diff', () => {
  it('accepts a display, a window of time and an optional region', () => {
    expect(PerceptionDiffParams.safeParse({ displayId: 1, sinceSeconds: 5 }).success).toBe(true);
    const parsed = PerceptionDiffParams.parse({
      displayId: 1,
      sinceSeconds: 60,
      rect: { x: 0, y: 0, width: 800, height: 600 },
      includeImages: false,
    });
    expect(parsed.rect?.width).toBe(800);
  });

  it('includes images unless told not to', () => {
    expect(PerceptionDiffParams.parse({ displayId: 1, sinceSeconds: 5 }).includeImages).toBe(true);
  });

  it('refuses zero seconds: a frame compared with itself says nothing', () => {
    expect(PerceptionDiffParams.safeParse({ displayId: 1, sinceSeconds: 0 }).success).toBe(false);
    expect(PerceptionDiffParams.safeParse({ sinceSeconds: 5 }).success).toBe(false);
  });

  it('returns a change ratio between 0 and 1 with before and after crops', () => {
    const result = PerceptionDiffResult.parse({
      changeRatio: 0.12,
      beforeAt: '2026-10-04T10:00:00.000Z',
      afterAt: '2026-10-04T10:00:05.000Z',
      bounds: { x: 10, y: 20, width: 300, height: 40 },
      before: image,
      after: image,
    });
    expect(result.changeRatio).toBe(0.12);
  });

  it('refuses a ratio outside 0 to 1', () => {
    const afterAt = '2026-10-04T10:00:05.000Z';
    expect(PerceptionDiffResult.safeParse({ changeRatio: 1.2, afterAt }).success).toBe(false);
    expect(PerceptionDiffResult.safeParse({ changeRatio: -0.1, afterAt }).success).toBe(false);
  });
});

describe('watch notifications', () => {
  it('watch.fired names the watch, the pet, the message and the display', () => {
    const fired = { watchId, petId: 'scout', message: 'The build finished.', displayId: 1 };
    expect(WatchFiredParams.safeParse(fired).success).toBe(true);
  });

  it('watch.fired refuses a missing message or a non-uuid watch', () => {
    expect(WatchFiredParams.safeParse({ watchId, petId: 'scout', displayId: 1 }).success).toBe(
      false,
    );
    expect(
      WatchFiredParams.safeParse({ watchId: 'w', petId: 'scout', message: 'x', displayId: 1 })
        .success,
    ).toBe(false);
  });

  it('watch.status reports each state with the checks spent', () => {
    for (const state of ['watching', 'fired', 'stopped', 'timeout', 'capped', 'error'] as const) {
      const status = {
        watchId,
        petId: 'scout',
        condition: 'the build finishes',
        displayId: 1,
        state,
        checks: 3,
        maxChecks: 60,
      };
      expect(WatchStatusParams.safeParse(status).success).toBe(true);
    }
    expect(
      WatchStatusParams.safeParse({
        watchId,
        petId: 'scout',
        condition: 'x',
        displayId: 1,
        state: 'sleeping',
        checks: 0,
        maxChecks: 60,
      }).success,
    ).toBe(false);
  });

  it('watch.status may name the model answering the checks', () => {
    const status = {
      watchId,
      petId: 'scout',
      condition: 'x',
      displayId: 1,
      state: 'watching',
      checks: 0,
      maxChecks: 60,
      checkModel: 'anthropic/claude-haiku-4.5',
    };
    expect(WatchStatusParams.parse(status).checkModel).toBe('anthropic/claude-haiku-4.5');
  });

  it('watch.stop takes a watch id and says whether it stopped one', () => {
    expect(WatchStopParams.safeParse({ watchId }).success).toBe(true);
    expect(WatchStopParams.safeParse({ watchId: 'nope' }).success).toBe(false);
    expect(WatchStopResult.parse({ stopped: true }).stopped).toBe(true);
  });
});

describe('catalog', () => {
  it('lists both perception methods, both notifications and watch.stop', () => {
    expect(coreToHostMethods['perception.recall'].params).toBe(PerceptionRecallParams);
    expect(coreToHostMethods['perception.diff'].result).toBe(PerceptionDiffResult);
    expect(coreToHostNotifications['watch.fired'].params).toBe(WatchFiredParams);
    expect(coreToHostNotifications['watch.status'].params).toBe(WatchStatusParams);
    expect(hostToCoreMethods['watch.stop'].params).toBe(WatchStopParams);
  });

  it('accepts recall as a host capability', () => {
    expect(HostCapability.safeParse('recall').success).toBe(true);
  });
});
