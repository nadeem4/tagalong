/** Tests for the lookout: trouble titles, meetings, the call rule and when a window gets a look. */
import { describe, expect, it } from 'vitest';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import {
  Lookout,
  SETTLE_MS,
  callOrFullScreenInFront,
  isMeeting,
  looksLikeTrouble,
} from './lookout';

const NONE: CaptureExclusions = { processNames: [], titlePatterns: [] };

function win(id: string, title: string, extra: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id,
    processName: 'Code.exe',
    title,
    state: 'foreground',
    browser: false,
    ...extra,
  };
}

const bg = (window: WindowEntry): WindowEntry => ({ ...window, state: 'background' });

function setup() {
  const clock = { t: 0, now: () => clock.t };
  const lookout = new Lookout(clock);
  const at = (ms: number, windows: WindowEntry[], exclusions = NONE) => {
    clock.t = ms;
    lookout.track(windows, exclusions);
    return lookout.pick(windows, exclusions);
  };
  return { clock, lookout, at };
}

describe('looksLikeTrouble', () => {
  it.each([
    'Build failed - Jenkins',
    'npm ERR! Error: Cannot find module',
    'Traceback (most recent call last)',
    'Unhandled exception in main.py',
    'CI failing on main',
    'pipeline - Failure',
  ])('reads "%s" as trouble', (title) => {
    expect(looksLikeTrouble(title)).toBe(true);
  });

  it.each(['Inbox - Outlook', 'Terror in the night - Netflix', 'README.md - Code', ''])(
    'leaves "%s" alone',
    (title) => {
      expect(looksLikeTrouble(title)).toBe(false);
    },
  );
});

describe('isMeeting', () => {
  it('knows Teams and Zoom by process, and Meet and Zoom calls by title', () => {
    expect(isMeeting(win('w-1', 'Chat', { processName: 'ms-teams.exe' }))).toBe(true);
    expect(isMeeting(win('w-1', 'Zoom', { processName: 'Zoom.exe' }))).toBe(true);
    expect(isMeeting(win('w-1', 'Meet - abc-defg-hij - Google Chrome'))).toBe(true);
    expect(isMeeting(win('w-1', 'Zoom Meeting'))).toBe(true);
    expect(isMeeting(win('w-1', 'meeting-notes.md - Code'))).toBe(false);
  });
});

describe('callOrFullScreenInFront', () => {
  it('is true for a full-screen front window and a Teams or Meet front window', () => {
    expect(callOrFullScreenInFront([win('w-1', 'Movie', { fullScreen: true })])).toBe(true);
    expect(callOrFullScreenInFront([win('w-1', 'Chat', { processName: 'ms-teams.exe' })])).toBe(
      true,
    );
    expect(callOrFullScreenInFront([win('w-1', 'Meet - abc-defg-hij - Google Chrome')])).toBe(true);
  });

  it('is false for a call behind another window, and with nothing in front', () => {
    const call = bg(win('w-2', 'Chat', { processName: 'ms-teams.exe' }));
    expect(callOrFullScreenInFront([win('w-1', 'parser.ts - Code'), call])).toBe(false);
    expect(callOrFullScreenInFront([call])).toBe(false);
    expect(callOrFullScreenInFront([])).toBe(false);
  });
});

describe('Lookout', () => {
  it('looks once the person has settled on a new window for thirty seconds', () => {
    const { at } = setup();
    const code = win('w-1', 'parser.ts - Code');
    expect(at(0, [code])).toBeNull();
    expect(at(SETTLE_MS - 1, [code])).toBeNull();
    expect(at(SETTLE_MS, [code])).toEqual({ window: code, why: 'settled' });
  });

  it('starts the thirty seconds again when the person moves to another window', () => {
    const { at } = setup();
    const a = win('w-1', 'a.ts - Code');
    const b = win('w-2', 'b.ts - Code');
    at(0, [a, bg(b)]);
    at(20_000, [bg(a), b]);
    expect(at(40_000, [a, bg(b)])).toBeNull();
    expect(at(40_000 + SETTLE_MS, [a, bg(b)])).toEqual({ window: a, why: 'settled' });
  });

  it('never looks at the same window twice, but a new title is a new window', () => {
    const { at } = setup();
    const code = win('w-1', 'parser.ts - Code');
    at(0, [code]);
    expect(at(SETTLE_MS, [code])).not.toBeNull();
    expect(at(SETTLE_MS * 3, [code])).toBeNull();
    const renamed = win('w-1', 'lexer.ts - Code');
    at(SETTLE_MS * 3 + 1, [renamed]);
    expect(at(SETTLE_MS * 4 + 1, [renamed])).toEqual({ window: renamed, why: 'settled' });
  });

  it('looks at a title that reads like trouble at once, even behind other windows', () => {
    const { at } = setup();
    const failing = bg(win('w-9', 'Build failed - Jenkins', { processName: 'chrome.exe' }));
    expect(at(0, [win('w-1', 'notes.txt'), failing])).toEqual({ window: failing, why: 'trouble' });
    expect(at(1_000, [win('w-1', 'notes.txt'), failing])).toBeNull();
  });

  it('ignores a minimized window, trouble or not', () => {
    const { at } = setup();
    const hidden = win('w-9', 'Build failed', { state: 'minimized' });
    expect(at(0, [hidden])).toBeNull();
    expect(at(SETTLE_MS, [hidden])).toBeNull();
  });

  it('a window only tracked, never picked (the gate was shut), is still there to pick', () => {
    const { clock, lookout, at } = setup();
    const a = win('w-1', 'a.ts - Code');
    clock.t = 0;
    lookout.track([a], NONE);
    clock.t = SETTLE_MS * 4;
    lookout.track([a], NONE);
    expect(at(SETTLE_MS * 5, [a])).toEqual({ window: a, why: 'settled' });
  });

  it('remembers the last plain title in front, for the project an error belongs to', () => {
    const { lookout, at } = setup();
    expect(lookout.lastClean()).toBeNull();
    at(0, [win('w-1', 'parser.ts - tagalong - Code')]);
    at(1_000, [win('w-2', 'npm test - failed', { processName: 'WindowsTerminal.exe' })]);
    at(2_000, [win('w-3', 'Vault', { processName: '1Password.exe' })]);
    at(3_000, [win('w-4', '  ')]);
    expect(lookout.lastClean()).toBe('parser.ts - tagalong - Code');
  });

  it('never considers a blind spot, by the host’s mark, the built-in list or the person’s own', () => {
    const { at } = setup();
    const marked = win('w-1', '', { blocked: { rule: 'processName', entry: 'x.exe' } });
    const vault = win('w-2', 'Error unlocking vault', { processName: '1Password.exe' });
    const mine = bg(win('w-3', 'Payroll failed - Excel'));
    const exclusions: CaptureExclusions = { processNames: [], titlePatterns: ['Payroll*'] };
    expect(at(0, [marked, bg(vault), mine], exclusions)).toBeNull();
    expect(at(SETTLE_MS, [marked, bg(vault), mine], exclusions)).toBeNull();
    // A blind spot in front still counts as being somewhere: nothing settles behind it.
    expect(at(SETTLE_MS * 2, [{ ...vault, state: 'foreground' }], exclusions)).toBeNull();
  });
});
