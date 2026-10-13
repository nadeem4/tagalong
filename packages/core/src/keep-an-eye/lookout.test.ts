import { describe, expect, it } from 'vitest';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import {
  COOLDOWN_MS,
  Lookout,
  NOT_NOW_MS,
  SETTLE_MS,
  isMeeting,
  looksLikeTrouble,
} from './lookout';

const NONE: CaptureExclusions = { processNames: [], titlePatterns: [] };

function win(
  id: string,
  title: string,
  extra: Partial<WindowEntry> = {},
): WindowEntry {
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
    return lookout.observe(windows, exclusions);
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

  it('says at most one thing every ten minutes', () => {
    const { at, lookout } = setup();
    const a = win('w-1', 'a.ts - Code');
    at(0, [a]);
    expect(at(SETTLE_MS, [a])).not.toBeNull();
    lookout.spoke();
    const failing = bg(win('w-2', 'Build failed'));
    expect(at(SETTLE_MS + 1_000, [a, failing])).toBeNull();
    expect(at(SETTLE_MS + COOLDOWN_MS, [a, failing])).toEqual({ window: failing, why: 'trouble' });
  });

  it('a look that found nothing to say does not start the ten minutes', () => {
    const { at } = setup();
    const a = win('w-1', 'a.ts - Code');
    at(0, [a]);
    expect(at(SETTLE_MS, [a])).not.toBeNull();
    const failing = bg(win('w-2', 'Build failed'));
    expect(at(SETTLE_MS + 1_000, [a, failing])).toEqual({ window: failing, why: 'trouble' });
  });

  it('stays quiet for an hour after Not now', () => {
    const { at, lookout } = setup();
    const quietUntil = lookout.notNow();
    expect(quietUntil).toBe(NOT_NOW_MS);
    const failing = win('w-2', 'Build failed');
    expect(at(1_000, [failing])).toBeNull();
    expect(at(NOT_NOW_MS, [failing])).toEqual({ window: failing, why: 'trouble' });
  });

  it('stays quiet while a full-screen window or a meeting is in front', () => {
    const { at } = setup();
    const failing = bg(win('w-2', 'Build failed'));
    const film = win('w-1', 'Movie', { fullScreen: true });
    expect(at(0, [film, failing])).toBeNull();
    const call = win('w-3', 'Meeting', { processName: 'Zoom.exe' });
    expect(at(1_000, [call, bg(film), failing])).toBeNull();
    expect(at(2_000, [bg(call), win('w-4', 'notes'), failing])).toEqual({
      window: failing,
      why: 'trouble',
    });
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
