import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaptureExclusions,
  ContextSnapshot,
  ContextSnapshotPatch,
  PerceptionTarget,
} from '@tagalong/protocol';
import {
  BROWSER_HOST_TIMEOUT_MS,
  browserContextFor,
  captureSelection,
  isBrowserHost,
} from './browser-route';
import type { PerceptionHost } from './tools';

const NO_EXCLUSIONS: CaptureExclusions = { processNames: [], titlePatterns: [] };

type FakeHost = PerceptionHost & { asked: PerceptionTarget[][] };

function host(
  capabilities: PerceptionHost['capabilities'],
  answer: (what: readonly PerceptionTarget[]) => Promise<ContextSnapshotPatch>,
): FakeHost {
  const asked: PerceptionTarget[][] = [];
  return {
    capabilities,
    asked,
    capture(what) {
      asked.push([...what]);
      return answer(what);
    },
  };
}

function desktop(app = { name: 'chrome.exe', windowTitle: 'Release notes - Google Chrome' }) {
  return host(['selection', 'activeWindow', 'clipboard', 'screenshot'], (what) =>
    Promise.resolve({
      ...(what.includes('activeWindow') ? { app } : {}),
      ...(what.includes('selection') ? { selection: 'clipboard-trick copy' } : {}),
    }),
  );
}

const PAGE = { url: 'https://example.com/notes', title: 'Release notes', text: 'The article.' };

function extension(
  answer: (what: readonly PerceptionTarget[]) => Promise<ContextSnapshotPatch> = (what) =>
    Promise.resolve({
      ...(what.includes('activeWindow')
        ? { app: { name: 'chrome', windowTitle: 'Release notes' } }
        : {}),
      ...(what.includes('selection') ? { selection: 'the exact words' } : {}),
      ...(what.includes('pageText') ? { page: PAGE } : {}),
    }),
) {
  return host(['selection', 'pageText', 'activeWindow'], answer);
}

/** Never answers, like a service worker Chrome has stopped mid-request. */
const silent = () => new Promise<ContextSnapshotPatch>(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('isBrowserHost', () => {
  it('is the host that can read page text', () => {
    expect(isBrowserHost(extension())).toBe(true);
    expect(isBrowserHost(desktop())).toBe(false);
  });
});

describe('captureSelection', () => {
  it('routes to the extension when a browser is in front and the extension is connected', async () => {
    const d = desktop();
    const e = extension();
    const result = await captureSelection({ hosts: [d, e], exclusions: NO_EXCLUSIONS });
    expect(result).toMatchObject({ selection: 'the exact words', source: 'extension' });
    expect(d.asked).toEqual([['activeWindow']]);
  });

  it('falls back to the desktop when the extension takes longer than 500 ms', async () => {
    const d = desktop();
    const e = extension(silent);
    const pending = captureSelection({ hosts: [d, e], exclusions: NO_EXCLUSIONS });
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ selection: 'clipboard-trick copy', source: 'desktop' });
    expect(BROWSER_HOST_TIMEOUT_MS).toBe(500);
  });

  it('falls back at once when the extension refuses, without waiting out the timer', async () => {
    const d = desktop();
    const e = extension(() =>
      Promise.reject(new Error('Chrome does not let extensions read chrome://settings')),
    );
    const result = await captureSelection({ hosts: [d, e], exclusions: NO_EXCLUSIONS });
    expect(result).toMatchObject({ source: 'desktop' });
  });

  it('asks the desktop when the front window is not a browser, even with the extension connected', async () => {
    const d = desktop({ name: 'notepad.exe', windowTitle: 'todo.txt' });
    const e = extension();
    const result = await captureSelection({ hosts: [d, e], exclusions: NO_EXCLUSIONS });
    expect(result).toMatchObject({ source: 'desktop' });
    expect(e.asked).toEqual([]);
  });

  it('asks the desktop when no extension is connected', async () => {
    const result = await captureSelection({ hosts: [desktop()], exclusions: NO_EXCLUSIONS });
    expect(result).toMatchObject({ selection: 'clipboard-trick copy', source: 'desktop' });
  });

  it('prefers the desktop for window identity, whichever host connected first', async () => {
    const d = desktop();
    const e = extension();
    await captureSelection({ hosts: [e, d], exclusions: NO_EXCLUSIONS });
    expect(d.asked[0]).toEqual(['activeWindow']);
    expect(e.asked).toEqual([['selection']]);
  });

  it('refuses before reading anything when the front window is excluded', async () => {
    const d = desktop({ name: 'chrome.exe', windowTitle: 'My Bank - Google Chrome' });
    const e = extension();
    const result = await captureSelection({
      hosts: [d, e],
      exclusions: { processNames: [], titlePatterns: ['*Bank*'] },
    });
    expect(result).toEqual({ blocked: { rule: 'titlePattern', entry: '*Bank*' } });
    expect(e.asked).toEqual([]);
  });

  it('works with only the extension connected', async () => {
    const e = extension();
    const result = await captureSelection({ hosts: [e], exclusions: NO_EXCLUSIONS });
    expect(result).toMatchObject({ selection: 'the exact words', source: 'extension' });
  });

  it('returns null when no host can read a selection', async () => {
    expect(await captureSelection({ hosts: [], exclusions: NO_EXCLUSIONS })).toBeNull();
  });
});

describe('browserContextFor', () => {
  const ASKED: ContextSnapshot = {
    id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
    capturedAt: '2026-10-04T00:00:00.000Z',
    host: 'desktop',
    app: { name: 'chrome.exe', windowTitle: 'Release notes - Google Chrome' },
    selection: 'clipboard-trick copy',
  };

  it('fills a desktop ask in a browser with the exact selection and the page', async () => {
    const e = extension();
    const filled = await browserContextFor(ASKED, {
      hosts: [desktop(), e],
      exclusions: NO_EXCLUSIONS,
    });
    expect(filled).toEqual({ ...ASKED, selection: 'the exact words', page: PAGE });
    expect(e.asked).toEqual([['selection', 'pageText', 'activeWindow']]);
  });

  it('keeps the desktop selection when the browser reports none', async () => {
    const e = extension(() => Promise.resolve({ page: PAGE }));
    const filled = await browserContextFor(ASKED, { hosts: [e], exclusions: NO_EXCLUSIONS });
    expect(filled?.selection).toBe('clipboard-trick copy');
    expect(filled?.page).toEqual(PAGE);
  });

  it('sends the ask as it was when the extension does not answer within 500 ms', async () => {
    const pending = browserContextFor(ASKED, {
      hosts: [desktop(), extension(silent)],
      exclusions: NO_EXCLUSIONS,
    });
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_TIMEOUT_MS);
    expect(await pending).toBe(ASKED);
  });

  it('leaves an ask from outside a browser alone', async () => {
    const e = extension();
    const notepad = { ...ASKED, app: { name: 'notepad.exe', windowTitle: 'todo.txt' } };
    expect(await browserContextFor(notepad, { hosts: [e], exclusions: NO_EXCLUSIONS })).toBe(
      notepad,
    );
    expect(e.asked).toEqual([]);
  });

  it('leaves the extension’s own asks alone: they already carry the page', async () => {
    const e = extension();
    const own = { ...ASKED, host: 'extension' as const };
    expect(await browserContextFor(own, { hosts: [e], exclusions: NO_EXCLUSIONS })).toBe(own);
    expect(e.asked).toEqual([]);
  });

  it('strips an extension ask made on an excluded tab down to the bare ask', async () => {
    const own: ContextSnapshot = {
      ...ASKED,
      host: 'extension',
      app: { name: 'chrome', windowTitle: 'My Bank — accounts' },
      selection: 'balance 1,234',
      page: PAGE,
    };
    const filled = await browserContextFor(own, {
      hosts: [],
      exclusions: { processNames: [], titlePatterns: ['*Bank*'] },
    });
    expect(filled).toEqual({
      id: own.id,
      capturedAt: own.capturedAt,
      host: 'extension',
      app: own.app,
    });
  });

  it('drops what the extension read when the tab it read is excluded', async () => {
    const e = extension(() =>
      Promise.resolve({
        app: { name: 'chrome', windowTitle: 'My Bank' },
        selection: 'balance',
        page: PAGE,
      }),
    );
    const filled = await browserContextFor(ASKED, {
      hosts: [e],
      exclusions: { processNames: [], titlePatterns: ['*Bank*'] },
    });
    expect(filled).toBe(ASKED);
  });

  it('passes an ask with no snapshot through', async () => {
    expect(
      await browserContextFor(undefined, { hosts: [extension()], exclusions: NO_EXCLUSIONS }),
    ).toBeUndefined();
  });
});
