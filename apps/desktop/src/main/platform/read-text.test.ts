import type { WindowEntry } from '@tagalong/protocol';
import { describe, expect, it, vi } from 'vitest';

import { readWindowTextWith } from './read-text';
import type { ReadWindowTextDeps } from './read-text';

function entry(partial: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'displays.ts',
    state: 'background',
    browser: false,
    ...partial,
  };
}

function deps(options: {
  windows?: WindowEntry[];
  text?: string;
  truncated?: boolean;
}): ReadWindowTextDeps & { read: ReturnType<typeof vi.fn> } {
  const read = vi.fn().mockResolvedValue({
    text: options.text ?? 'const x = 1',
    truncated: options.truncated ?? false,
  });
  return {
    read,
    listWindows: () => Promise.resolve(options.windows ?? [entry()]),
    textLayer: { readWindowText: read, countWindowText: vi.fn() },
  };
}

describe('readWindowTextWith', () => {
  it('reads the window it was asked for', async () => {
    const d = deps({});
    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.windowId).toBe('w-1');
    expect(result.text).toBe('const x = 1');
    expect(result.source).toBe('uia');
    expect(d.read).toHaveBeenCalledWith(1, 8_000);
  });

  it('reads the foreground window when none is named', async () => {
    const d = deps({
      windows: [entry({ id: 'w-1' }), entry({ id: 'w-9', state: 'foreground' })],
    });

    const result = await readWindowTextWith(d, { maxChars: 8_000 });

    expect(result.windowId).toBe('w-9');
    expect(d.read).toHaveBeenCalledWith(9, 8_000);
  });

  it('refuses an excluded window before reading a character of it', async () => {
    // The check is the point: a read that happens and is then discarded has already put
    // the vault's contents in this process's memory.
    const d = deps({
      windows: [
        entry({
          id: 'w-1',
          processName: '1Password.exe',
          blocked: { rule: 'processName', entry: '1Password.exe' },
        }),
      ],
    });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    expect(result.text).toBe('');
    expect(d.read).not.toHaveBeenCalled();
  });

  it('says which rule refused, so the user can find the line that did it', async () => {
    const d = deps({
      windows: [entry({ blocked: { rule: 'titlePattern', entry: '*Vault*' } })],
    });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.notes?.join(' ')).toContain('*Vault*');
  });

  it('answers honestly for a window it has never heard of', async () => {
    // The model can invent a window id, or name one that closed since the inventory.
    const d = deps({ windows: [entry({ id: 'w-1' })] });

    const result = await readWindowTextWith(d, { windowId: 'w-404', maxChars: 8_000 });

    expect(result.text).toBe('');
    expect(result.notes?.join(' ')).toMatch(/no window|no longer open|closed since/i);
    expect(d.read).not.toHaveBeenCalled();
  });

  it('answers honestly when there is no foreground window to fall back to', async () => {
    const d = deps({ windows: [entry({ state: 'background' })] });

    const result = await readWindowTextWith(d, { maxChars: 8_000 });

    expect(result.text).toBe('');
    expect(d.read).not.toHaveBeenCalled();
  });

  it('attaches the caveat when a window published only a sliver', async () => {
    // Measured: a minimized editor returns about 456 characters of menus and tab titles.
    const d = deps({ text: 'x'.repeat(456), windows: [entry({ state: 'minimized' })] });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.notes?.length).toBeGreaterThan(0);
    expect(result.notes?.join(' ')).toContain('Code');
  });

  it('says nothing extra when a window published plenty', async () => {
    const d = deps({ text: 'y'.repeat(5_000) });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.notes).toBeUndefined();
  });

  it('tells the pet a browser read covers one tab', async () => {
    const d = deps({ text: 'y'.repeat(5_000), windows: [entry({ browser: true })] });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.notes?.join(' ')).toMatch(/active tab/i);
  });

  it('flags truncation both in the field and in the notes', async () => {
    const d = deps({ text: 'y'.repeat(8_000), truncated: true });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.truncated).toBe(true);
    expect(result.notes?.join(' ')).toMatch(/beginning/i);
  });

  it('never returns an empty notes array, which the protocol would reject', async () => {
    const d = deps({ text: 'y'.repeat(5_000) });

    const result = await readWindowTextWith(d, { windowId: 'w-1', maxChars: 8_000 });

    expect(result.notes === undefined || result.notes.length > 0).toBe(true);
  });
});
