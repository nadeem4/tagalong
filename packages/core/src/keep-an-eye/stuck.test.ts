/** Tests for StuckWatch: three minutes, once per error, cooldown and quiet. */
import { describe, expect, it } from 'vitest';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import { STUCK_COOLDOWN_MS, STUCK_MS, StuckWatch } from './stuck';

const none: CaptureExclusions = { processNames: [], titlePatterns: [] };

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

function behind(window: WindowEntry): WindowEntry {
  return { ...window, state: 'background' };
}

function setup() {
  const clock = { t: 0, now: () => clock.t };
  const watch = new StuckWatch(clock);
  const at = (ms: number, windows: WindowEntry[], exclusions = none) => {
    clock.t = ms;
    return watch.observe(windows, exclusions);
  };
  return { watch, at, clock };
}

const failing = win('w-1', 'npm test - 2 failed');

describe('StuckWatch', () => {
  it('fires once the error has been up three minutes, not a second before', () => {
    const { at } = setup();
    expect(at(0, [failing])).toBeNull();
    expect(at(STUCK_MS - 1_000, [failing])).toBeNull();
    expect(at(STUCK_MS, [failing])).toEqual({ window: failing, projectHint: failing.title });
    // Once per window.
    expect(at(STUCK_MS * 2, [failing])).toBeNull();
  });

  it('starts again when the title changes', () => {
    const { at } = setup();
    at(0, [failing]);
    const rerun = win('w-1', 'npm test - 1 failed');
    expect(at(STUCK_MS - 1_000, [rerun])).toBeNull();
    expect(at(STUCK_MS, [rerun])).toBeNull();
    expect(at(STUCK_MS * 2 - 1_000, [rerun])).toEqual({ window: rerun, projectHint: rerun.title });
  });

  it('forgets an error that is closed or minimized', () => {
    const { at } = setup();
    at(0, [failing]);
    at(60_000, [{ ...failing, state: 'minimized' }]);
    expect(at(STUCK_MS, [failing])).toBeNull();
    at(STUCK_MS + 60_000, []);
    expect(at(STUCK_MS * 2 + 60_000, [failing])).toBeNull();
    expect(at(STUCK_MS * 3 + 60_000, [failing])).not.toBeNull();
  });

  it('waits until the error is in front', () => {
    const { at } = setup();
    const editor = win('w-2', 'parser.ts - ai_pet - Visual Studio Code', {
      processName: 'Code.exe',
    });
    at(0, [editor, behind(failing)]);
    expect(at(STUCK_MS, [editor, behind(failing)])).toBeNull();
    expect(at(STUCK_MS + 1_000, [failing, behind(editor)])).not.toBeNull();
  });

  it('says nothing over a call or a full-screen window', () => {
    const { at } = setup();
    const call = win('w-3', 'Standup | Microsoft Teams', { processName: 'ms-teams.exe' });
    at(0, [behind(failing), call]);
    expect(at(STUCK_MS, [behind(failing), call])).toBeNull();
    const big = { ...failing, fullScreen: true };
    expect(at(STUCK_MS, [big])).toBeNull();
  });

  it('never fires for a blind spot', () => {
    const { at } = setup();
    const blocked = { ...failing, blocked: { rule: 'processName' as const, entry: 'x.exe' } };
    at(0, [blocked]);
    expect(at(STUCK_MS, [blocked])).toBeNull();
    const listed = { processNames: ['WindowsTerminal.exe'], titlePatterns: [] };
    const other = setup();
    other.at(0, [failing], listed);
    expect(other.at(STUCK_MS, [failing], listed)).toBeNull();
  });

  it('keeps count but offers nothing, and uses nothing up, while not ready', () => {
    const { watch, clock } = setup();
    clock.t = 0;
    watch.observe([failing], none, false);
    clock.t = STUCK_MS;
    expect(watch.observe([failing], none, false)).toBeNull();
    expect(watch.observe([failing], none)).toEqual({ window: failing, projectHint: failing.title });
  });

  it('stays quiet until Not now ends', () => {
    const { at, watch } = setup();
    watch.quietUntil(STUCK_MS * 4);
    at(0, [failing]);
    expect(at(STUCK_MS, [failing])).toBeNull();
    expect(at(STUCK_MS * 4, [failing])).not.toBeNull();
  });

  it('fires at most once in thirty minutes', () => {
    const { at } = setup();
    const other = win('w-4', 'Build failed');
    at(0, [failing, behind(other)]);
    expect(at(STUCK_MS, [failing, behind(other)])).not.toBeNull();
    expect(at(STUCK_MS + 1_000, [other, behind(failing)])).toBeNull();
    expect(at(STUCK_MS + STUCK_COOLDOWN_MS, [other, behind(failing)])).toEqual({
      window: other,
      projectHint: other.title,
    });
  });

  it('adds the last window without trouble in front, usually the editor, to the hint', () => {
    const { at } = setup();
    const editor = win('w-2', 'parser.ts - ai_pet - Visual Studio Code', {
      processName: 'Code.exe',
    });
    at(0, [editor, behind(failing)]);
    at(1_000, [failing, behind(editor)]);
    expect(at(STUCK_MS, [failing, behind(editor)])).toEqual({
      window: failing,
      projectHint: `${failing.title} - ${editor.title}`,
    });
  });
});
