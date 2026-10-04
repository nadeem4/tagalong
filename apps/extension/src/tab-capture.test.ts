import { describe, expect, it, vi } from 'vitest';
import { ContextSnapshot, ContextSnapshotPatch, MAX_PAGE_TEXT_CHARS } from '@tagalong/protocol';
import type { PageReading } from './content/read-page';
import { captureSnapshot, captureTab } from './tab-capture';
import type { TabAccess } from './tab-capture';

const READING: PageReading = {
  url: 'https://example.com/notes',
  title: 'Release notes — Example',
  selection: 'the exact words',
  selectionTruncated: false,
  text: 'The readable article.',
  truncated: false,
};

function access(
  overrides: Partial<TabAccess> = {},
): TabAccess & { inject: ReturnType<typeof vi.fn> } {
  return {
    browser: 'chrome',
    activeTab: () =>
      Promise.resolve({
        id: 7,
        url: 'https://example.com/notes',
        title: 'Release notes — Example',
      }),
    inject: vi.fn(() => Promise.resolve(READING)),
    ...overrides,
  } as TabAccess & { inject: ReturnType<typeof vi.fn> };
}

describe('captureTab', () => {
  it('returns the exact selection when asked for it', async () => {
    const patch = await captureTab(['selection'], access());
    expect(patch).toEqual({ selection: 'the exact words' });
    expect(ContextSnapshotPatch.safeParse(patch).success).toBe(true);
  });

  it('returns the page URL, title and text for pageText', async () => {
    const patch = await captureTab(['pageText'], access());
    expect(patch.page).toEqual({
      url: 'https://example.com/notes',
      title: 'Release notes — Example',
      text: 'The readable article.',
    });
  });

  it('names the browser and tab for activeWindow without touching the page', async () => {
    const a = access();
    const patch = await captureTab(['activeWindow'], a);
    expect(patch).toEqual({ app: { name: 'chrome', windowTitle: 'Release notes — Example' } });
    expect(a.inject).not.toHaveBeenCalled();
  });

  it('reads the page once however many targets need it', async () => {
    const a = access();
    await captureTab(['selection', 'pageText', 'activeWindow'], a);
    expect(a.inject).toHaveBeenCalledTimes(1);
    expect(a.inject).toHaveBeenCalledWith(7);
  });

  it('leaves out an empty selection rather than sending an empty string', async () => {
    const a = access({ inject: vi.fn(() => Promise.resolve({ ...READING, selection: '' })) });
    expect(await captureTab(['selection'], a)).toEqual({});
  });

  it('ignores targets it cannot perceive, such as a screenshot', async () => {
    const a = access();
    expect(await captureTab(['screenshot', 'displays'], a)).toEqual({});
    expect(a.inject).not.toHaveBeenCalled();
  });

  it('refuses a browser page it may not script, saying which', async () => {
    const a = access({
      activeTab: () => Promise.resolve({ id: 3, url: 'chrome://settings', title: 'Settings' }),
    });
    await expect(captureTab(['pageText'], a)).rejects.toThrow(/chrome:\/\/settings/);
  });

  it('fails plainly when there is no tab to read', async () => {
    const a = access({ activeTab: () => Promise.resolve(null) });
    await expect(captureTab(['selection'], a)).rejects.toThrow(/no active tab/);
  });

  it('keeps a capped page within the protocol limit', async () => {
    const long = { ...READING, text: 'x'.repeat(MAX_PAGE_TEXT_CHARS), truncated: true };
    const patch = await captureTab(
      ['pageText'],
      access({ inject: vi.fn(() => Promise.resolve(long)) }),
    );
    expect(ContextSnapshotPatch.safeParse(patch).success).toBe(true);
  });
});

describe('captureSnapshot', () => {
  it('wraps the reading in a full extension snapshot the engine accepts', async () => {
    const snapshot = await captureSnapshot(['selection', 'pageText', 'activeWindow'], access(), {
      id: () => '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
      now: () => new Date('2026-10-04T00:00:00.000Z'),
    });
    expect(ContextSnapshot.parse(snapshot)).toEqual({
      id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
      capturedAt: '2026-10-04T00:00:00.000Z',
      host: 'extension',
      app: { name: 'chrome', windowTitle: 'Release notes — Example' },
      selection: 'the exact words',
      page: {
        url: 'https://example.com/notes',
        title: 'Release notes — Example',
        text: 'The readable article.',
      },
    });
  });
});
