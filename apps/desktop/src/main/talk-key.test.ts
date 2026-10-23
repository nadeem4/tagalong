/** Tests for the talk key: one key held alone, watched through a key hook driven by fakes here. */

import { describe, expect, it, vi } from 'vitest';
import { TALK_KEYCODES, TalkKeyWatch, startTalkKey } from './talk-key';
import type { KeyHook } from './talk-key';

const RIGHT_CTRL = TALK_KEYCODES.RightControl;
const C = 46;

function watch(): { watch: TalkKeyWatch; heard: string[] } {
  const heard: string[] = [];
  const made = new TalkKeyWatch({
    onPress: () => heard.push('press'),
    onRelease: () => heard.push('release'),
    onCancel: () => heard.push('cancel'),
  });
  return { watch: made, heard };
}

/** A key hook the test drives by hand. */
function fakeHook(failStart = false): KeyHook & {
  down: (keycode: number) => void;
  up: (keycode: number) => void;
  started: boolean;
  stopped: boolean;
} {
  const listeners: Record<'keydown' | 'keyup', ((event: { keycode: number }) => void)[]> = {
    keydown: [],
    keyup: [],
  };
  const hook = {
    started: false,
    stopped: false,
    on: (event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void) => {
      listeners[event].push(listener);
    },
    start: () => {
      if (failStart) throw new Error('hook refused');
      hook.started = true;
    },
    stop: () => {
      hook.stopped = true;
    },
    down: (keycode: number) => listeners.keydown.forEach((listener) => listener({ keycode })),
    up: (keycode: number) => listeners.keyup.forEach((listener) => listener({ keycode })),
  };
  return hook;
}

describe('TalkKeyWatch', () => {
  it('is Right Ctrl until told otherwise: down is the press, up is the release', () => {
    const { watch: made, heard } = watch();
    made.keyDown(RIGHT_CTRL);
    made.keyUp(RIGHT_CTRL);
    expect(heard).toEqual(['press', 'release']);
  });

  it('ignores the repeats of the key held down', () => {
    const { watch: made, heard } = watch();
    made.keyDown(RIGHT_CTRL);
    made.keyDown(RIGHT_CTRL);
    made.keyDown(RIGHT_CTRL);
    made.keyUp(RIGHT_CTRL);
    expect(heard).toEqual(['press', 'release']);
  });

  it('cancels when another key goes down while it is held: a shortcut, not a question', () => {
    const { watch: made, heard } = watch();
    made.keyDown(RIGHT_CTRL);
    made.keyDown(C);
    made.keyUp(C);
    made.keyDown(C);
    made.keyUp(RIGHT_CTRL);
    expect(heard).toEqual(['press', 'cancel']);
  });

  it('ignores every other key while the talk key is up', () => {
    const { watch: made, heard } = watch();
    made.keyDown(C);
    made.keyUp(C);
    made.keyUp(RIGHT_CTRL);
    expect(heard).toEqual([]);
  });

  it('starts fresh on the next press after a cancel', () => {
    const { watch: made, heard } = watch();
    made.keyDown(RIGHT_CTRL);
    made.keyDown(C);
    made.keyUp(RIGHT_CTRL);
    made.keyDown(RIGHT_CTRL);
    made.keyUp(RIGHT_CTRL);
    expect(heard).toEqual(['press', 'cancel', 'press', 'release']);
  });

  it('watches the key picked in Settings instead', () => {
    const { watch: made, heard } = watch();
    made.setKey('RightShift');
    made.keyDown(RIGHT_CTRL);
    made.keyUp(RIGHT_CTRL);
    made.keyDown(TALK_KEYCODES.RightShift);
    made.keyUp(TALK_KEYCODES.RightShift);
    expect(heard).toEqual(['press', 'release']);
  });

  it('has a distinct keycode for every talk key', () => {
    const codes = Object.values(TALK_KEYCODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('startTalkKey', () => {
  it('feeds the hook into the watch and stops it on quit', async () => {
    const hook = fakeHook();
    const { watch: made, heard } = watch();
    const started = await startTalkKey(async () => hook, made);
    expect(started.error).toBeNull();
    expect(hook.started).toBe(true);
    hook.down(RIGHT_CTRL);
    hook.up(RIGHT_CTRL);
    expect(heard).toEqual(['press', 'release']);
    started.stop();
    expect(hook.stopped).toBe(true);
  });

  it('reports a hook that will not load, once, and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = await startTalkKey(async () => {
      throw new Error('no binary');
    }, watch().watch);
    expect(started.error).toContain('no binary');
    expect(started.error).toContain('mic button');
    expect(warn).toHaveBeenCalledOnce();
    expect(() => started.stop()).not.toThrow();
    warn.mockRestore();
  });

  it('reports a hook that loads but will not start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = await startTalkKey(async () => fakeHook(true), watch().watch);
    expect(started.error).toContain('hook refused');
    warn.mockRestore();
  });

  it('never hands a key to the log: only the failure is written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hook = fakeHook();
    await startTalkKey(async () => hook, watch().watch);
    hook.down(C);
    hook.up(C);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
  });
});
