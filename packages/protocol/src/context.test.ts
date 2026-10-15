import { describe, expect, it } from 'vitest';
import {
  ContextSnapshot,
  DisplaySnapshot,
  MAX_PAGE_TEXT_CHARS,
  MAX_SELECTION_CHARS,
  PerceptionTarget,
  WindowEntry,
} from './context';

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

  it('parses an extension snapshot carrying page text', () => {
    const parsed = ContextSnapshot.parse({
      ...valid,
      host: 'extension',
      page: { url: 'https://example.com/a', title: 'A', text: 'body text' },
    });
    expect(parsed.page?.url).toBe('https://example.com/a');
  });

  it('rejects an unknown host kind', () => {
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

  it('caps page text at the documented budget', () => {
    const page = {
      url: 'https://example.com',
      title: 'T',
      text: 'x'.repeat(MAX_PAGE_TEXT_CHARS + 1),
    };
    expect(ContextSnapshot.safeParse({ ...valid, page }).success).toBe(false);
  });

  it('accepts a png screenshot block', () => {
    const parsed = ContextSnapshot.parse({
      ...valid,
      screenshot: { mime: 'image/png', base64: 'aGk=', width: 1568, height: 900 },
    });
    expect(parsed.screenshot?.width).toBe(1568);
  });

  it('rejects a screenshot that is not png', () => {
    const screenshot = { mime: 'image/jpeg', base64: 'aGk=', width: 10, height: 10 };
    expect(ContextSnapshot.safeParse({ ...valid, screenshot }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 2B: full view
// ---------------------------------------------------------------------------

const display = {
  id: 2528732444,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: true,
  focused: true,
};

const png = { mime: 'image/png', base64: 'aGk=', width: 1568, height: 882 };

const window_ = {
  id: 'w-1',
  processName: 'Code.exe',
  title: 'displays.ts — tagalong',
  displayId: 2528732444,
  state: 'background',
  browser: false,
};

describe('DisplaySnapshot', () => {
  it('parses a display with no image, which is a display nothing could capture', () => {
    const parsed = DisplaySnapshot.parse(display);
    expect(parsed.image).toBeUndefined();
    expect(parsed.blocked).toBeUndefined();
  });

  it('parses a display carrying its picture', () => {
    expect(DisplaySnapshot.parse({ ...display, image: png }).image?.width).toBe(1568);
  });

  it('parses a blocked display and keeps the rule that refused it', () => {
    const parsed = DisplaySnapshot.parse({
      ...display,
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });
    expect(parsed.blocked?.entry).toBe('1Password.exe');
  });

  it('accepts negative bounds, which is how Windows describes a monitor to the left', () => {
    expect(
      DisplaySnapshot.safeParse({
        ...display,
        bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
      }).success,
    ).toBe(true);
  });

  it('rejects a display with no width', () => {
    expect(
      DisplaySnapshot.safeParse({ ...display, bounds: { x: 0, y: 0, width: 0, height: 1080 } })
        .success,
    ).toBe(false);
  });

  it('rejects a scale factor of zero', () => {
    expect(DisplaySnapshot.safeParse({ ...display, scaleFactor: 0 }).success).toBe(false);
  });

  it('rejects an exclusion rule it does not know', () => {
    expect(
      DisplaySnapshot.safeParse({ ...display, blocked: { rule: 'vibes', entry: 'x' } }).success,
    ).toBe(false);
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

describe('ContextSnapshot, full view fields', () => {
  it('parses a snapshot carrying displays, a composite and a window inventory', () => {
    const parsed = ContextSnapshot.parse({
      ...valid,
      displays: [{ ...display, image: png }],
      composite: png,
      windows: [window_],
    });
    expect(parsed.displays).toHaveLength(1);
    expect(parsed.composite?.mime).toBe('image/png');
    expect(parsed.windows?.[0]?.processName).toBe('Code.exe');
  });

  it('still parses a Phase 1 snapshot with none of them', () => {
    const parsed = ContextSnapshot.parse(valid);
    expect(parsed.displays).toBeUndefined();
    expect(parsed.composite).toBeUndefined();
    expect(parsed.windows).toBeUndefined();
  });

  it('accepts an empty display list without accepting a malformed one', () => {
    expect(ContextSnapshot.safeParse({ ...valid, displays: [] }).success).toBe(true);
    expect(ContextSnapshot.safeParse({ ...valid, displays: [{ id: 1 }] }).success).toBe(false);
  });

  it('rejects a composite that is not a PNG', () => {
    expect(
      ContextSnapshot.safeParse({ ...valid, composite: { ...png, mime: 'image/jpeg' } }).success,
    ).toBe(false);
  });
});

describe('PerceptionTarget', () => {
  it('knows the two new full-view targets', () => {
    expect(PerceptionTarget.safeParse('displays').success).toBe(true);
    expect(PerceptionTarget.safeParse('windows').success).toBe(true);
  });

  it('still knows the Phase 1 and Phase 2 targets', () => {
    for (const target of ['selection', 'screenshot', 'activeWindow', 'clipboard', 'pageText']) {
      expect(PerceptionTarget.safeParse(target).success, target).toBe(true);
    }
  });
});

describe('ContextSnapshot.dropped', () => {
  const png = { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 4, height: 3 };

  it('parses each kind of thing dropped on Scout', () => {
    for (const dropped of [
      { kind: 'text', text: 'a paragraph' },
      { kind: 'link', text: 'https://example.com/post' },
      { kind: 'file', name: 'report.md', path: 'C:\\work\\report.md', size: 120, text: '# Hi' },
      { kind: 'image', name: 'chart.png', path: '/home/a/chart.png', image: png },
    ]) {
      expect(ContextSnapshot.parse({ ...valid, dropped }).dropped).toEqual(dropped);
    }
  });

  it('rejects an unknown kind', () => {
    expect(ContextSnapshot.safeParse({ ...valid, dropped: { kind: 'folder' } }).success).toBe(
      false,
    );
  });

  it('rejects dropped text past the selection cap', () => {
    const text = 'x'.repeat(MAX_SELECTION_CHARS + 1);
    expect(ContextSnapshot.safeParse({ ...valid, dropped: { kind: 'text', text } }).success).toBe(
      false,
    );
  });
});
