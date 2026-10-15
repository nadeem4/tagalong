import { describe, expect, it } from 'vitest';
import type { CaptureExclusions, HandoffFinishedParams, WindowEntry } from '@tagalong/protocol';
import { MOOD_COOLDOWN_MS, MoodWatch, moodForHandoff } from './mood';

const NONE: CaptureExclusions = { processNames: [], titlePatterns: [] };

function win(id: string, title: string, extra: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id,
    processName: 'WindowsTerminal.exe',
    title,
    state: 'foreground',
    browser: false,
    ...extra,
  };
}

function setup() {
  const clock = { t: 0, now: () => clock.t };
  const watch = new MoodWatch(clock);
  const at = (ms: number, windows: WindowEntry[], exclusions = NONE) => {
    clock.t = ms;
    return watch.observe(windows, exclusions);
  };
  return { at };
}

describe('MoodWatch', () => {
  it('winces once when the front title newly reads like trouble, not twice', () => {
    const { at } = setup();
    expect(at(0, [win('w-1', 'npm test')])).toBeNull();
    expect(at(1_000, [win('w-1', 'npm test - 2 failed')])).toBe('wince');
    expect(at(MOOD_COOLDOWN_MS * 2, [win('w-1', 'npm test - 2 failed')])).toBeNull();
  });

  it('cheers when the same window stops reading like trouble', () => {
    const { at } = setup();
    expect(at(0, [win('w-1', 'Build failed')])).toBe('wince');
    expect(at(MOOD_COOLDOWN_MS, [win('w-1', 'npm test')])).toBe('cheer');
  });

  it('cheers when the title newly reads like passing', () => {
    const { at } = setup();
    expect(at(0, [win('w-1', 'jest - 12 passed')])).toBe('cheer');
    expect(at(MOOD_COOLDOWN_MS * 2, [win('w-1', 'jest - 12 passed')])).toBeNull();
    expect(at(MOOD_COOLDOWN_MS * 3, [win('w-2', 'Deploy ✓')])).toBe('cheer');
  });

  it('reacts to nothing in a blind spot, a full-screen window or a call', () => {
    const { at } = setup();
    expect(
      at(0, [
        win('w-1', 'Build failed', { blocked: { rule: 'processName', entry: 'secret.exe' } }),
      ]),
    ).toBeNull();
    const exclusions = { processNames: ['WindowsTerminal.exe'], titlePatterns: [] };
    expect(at(1, [win('w-2', 'Build failed')], exclusions)).toBeNull();
    expect(at(2, [win('w-3', 'Build failed', { fullScreen: true })])).toBeNull();
    expect(at(3, [win('w-4', 'Build failed - Teams', { processName: 'ms-teams.exe' })])).toBeNull();
    expect(at(4, [win('w-5', 'Build failed', { state: 'background' })])).toBeNull();
  });

  it('reacts at most once a minute, so a flapping title cannot make it twitch', () => {
    const { at } = setup();
    expect(at(0, [win('w-1', 'Build failed')])).toBe('wince');
    expect(at(10_000, [win('w-1', 'Build succeeded')])).toBeNull();
    expect(at(20_000, [win('w-1', 'Build failed')])).toBeNull();
    expect(at(MOOD_COOLDOWN_MS + 1, [win('w-1', 'Build failed')])).toBeNull();
  });
});

describe('moodForHandoff', () => {
  const base: HandoffFinishedParams = {
    handoffId: '11111111-2222-4333-8444-555555555555',
    expertId: 'claude-code',
    state: 'done',
  };

  it('winces at an error', () => {
    expect(moodForHandoff({ ...base, state: 'error', error: 'boom' })).toBe('wince');
  });

  it('cheers when the tests pass', () => {
    expect(moodForHandoff({ ...base, text: 'Fixed it, all tests pass.' })).toBe('cheer');
    expect(moodForHandoff({ ...base, text: '42 passed in 3s' })).toBe('cheer');
  });

  it('winces when the text counts failures', () => {
    expect(moodForHandoff({ ...base, text: '3 failed, 9 passed' })).toBe('wince');
  });

  it('leaves a plain finish to the done face', () => {
    expect(moodForHandoff({ ...base, text: 'Renamed the function.' })).toBeNull();
    expect(moodForHandoff(base)).toBeNull();
    expect(moodForHandoff({ ...base, state: 'stopped' })).toBeNull();
  });
});
