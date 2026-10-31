/** Tests for the context snapshot, screens, windows and dropped items. */
import { describe, expect, it } from 'vitest';
import { ContextSnapshot, MAX_SELECTION_CHARS, ScreenInfo, WindowEntry } from './context';

const valid = {
  id: '9f1d6b64-2a5e-4f3a-9c11-8a2e7b4d5c60',
  capturedAt: '2026-09-11T23:15:00.000Z',
  host: 'desktop',
  app: { name: 'Code.exe', windowTitle: 'index.ts - tagalong' },
  selection: 'the highlighted paragraph',
};

describe('ContextSnapshot', () => {
  it('parses a desktop snapshot with a selection', () => {
    const parsed = ContextSnapshot.parse(valid);
    expect(parsed.host).toBe('desktop');
    expect(parsed.app?.name).toBe('Code.exe');
  });

  it('rejects any host but the desktop', () => {
    expect(ContextSnapshot.safeParse({ ...valid, host: 'extension' }).success).toBe(false);
    expect(ContextSnapshot.safeParse({ ...valid, host: 'toaster' }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(ContextSnapshot.safeParse({ ...valid, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a non-ISO capturedAt', () => {
    expect(ContextSnapshot.safeParse({ ...valid, capturedAt: 'yesterday' }).success).toBe(false);
  });

  it('caps the selection at the documented budget', () => {
    expect(
      ContextSnapshot.safeParse({ ...valid, selection: 'x'.repeat(MAX_SELECTION_CHARS) }).success,
    ).toBe(true);
    expect(
      ContextSnapshot.safeParse({ ...valid, selection: 'x'.repeat(MAX_SELECTION_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});

const png = { mime: 'image/png', base64: 'aGk=', width: 1568, height: 882 };

const window_ = {
  id: 'w-1',
  processName: 'Code.exe',
  title: 'sight.md - tagalong',
  displayId: 2528732444,
  state: 'background',
  browser: false,
};

describe('ScreenInfo', () => {
  it('accepts negative bounds, which is how Windows describes a monitor to the left', () => {
    expect(
      ScreenInfo.safeParse({
        id: 2,
        bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
        primary: false,
      }).success,
    ).toBe(true);
  });

  it('rejects a display with no width', () => {
    expect(
      ScreenInfo.safeParse({ id: 2, bounds: { x: 0, y: 0, width: 0, height: 1080 }, primary: true })
        .success,
    ).toBe(false);
  });
});

describe('ContextSnapshot.dropped', () => {
  it.each(['text', 'link', 'file', 'image'] as const)('parses a dropped %s', (kind) => {
    const dropped = kind === 'image' ? { kind, image: png } : { kind, text: 'hello' };
    expect(ContextSnapshot.parse({ ...valid, dropped }).dropped?.kind).toBe(kind);
  });

  it('rejects a kind it does not know', () => {
    expect(ContextSnapshot.safeParse({ ...valid, dropped: { kind: 'video' } }).success).toBe(false);
  });

  it('rejects dropped text past the cap', () => {
    const text = 'x'.repeat(MAX_SELECTION_CHARS + 1);
    expect(ContextSnapshot.safeParse({ ...valid, dropped: { kind: 'text', text } }).success).toBe(
      false,
    );
  });
});
describe('WindowEntry', () => {
  it('parses a background window', () => {
    const parsed = WindowEntry.parse(window_);
    expect(parsed.state).toBe('background');
    expect(parsed.textChars).toBeUndefined();
  });

  it('carries a character count once the text layer can supply one', () => {
    expect(WindowEntry.parse({ ...window_, textChars: 34588 }).textChars).toBe(34588);
  });

  it('parses a minimized window, which UI Automation can still read', () => {
    expect(WindowEntry.safeParse({ ...window_, state: 'minimized' }).success).toBe(true);
  });

  it('allows an empty title, because plenty of real windows have none', () => {
    expect(WindowEntry.safeParse({ ...window_, title: '' }).success).toBe(true);
  });

  it('rejects a state it does not know', () => {
    expect(WindowEntry.safeParse({ ...window_, state: 'hidden' }).success).toBe(false);
  });

  it('rejects a negative character count', () => {
    expect(WindowEntry.safeParse({ ...window_, textChars: -1 }).success).toBe(false);
  });

  it('marks a blocked window and gives it no character count', () => {
    // The count is itself a small leak: knowing an excluded vault holds 4,000 characters
    // says more than nothing at all.
    const parsed = WindowEntry.parse({
      ...window_,
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });
    expect(parsed.blocked?.rule).toBe('processName');
    expect(parsed.textChars).toBeUndefined();
  });
});
