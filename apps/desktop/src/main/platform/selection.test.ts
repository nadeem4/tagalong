/** Tests for the clipboard trick. */

import { describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION_CHARS } from '@tagalong/protocol';
import { COPY_SETTLE_MS, captureSelectionWith } from './selection';
import type { ClipboardPort } from './selection';

/** A clipboard whose contents the test drives, standing in for the OS one. */
function fakeClipboard(initial: string): ClipboardPort & { text: string; writes: string[] } {
  return {
    text: initial,
    writes: [],
    async readText() {
      return this.text;
    },
    async writeText(value: string) {
      this.text = value;
      this.writes.push(value);
    },
  };
}

function deps(clipboard: ClipboardPort, sendCopy: () => Promise<void>, log?: (m: string) => void) {
  return {
    clipboard,
    sendCopy,
    wait: async () => {},
    ...(log !== undefined ? { log } : {}),
  };
}

describe('captureSelectionWith', () => {
  it('returns what the copy put on the clipboard and restores the original', async () => {
    const clipboard = fakeClipboard('what the user had copied earlier');
    const copy = vi.fn(async () => {
      await clipboard.writeText('the highlighted paragraph');
    });

    const selection = await captureSelectionWith(deps(clipboard, copy));

    expect(selection).toBe('the highlighted paragraph');
    expect(copy).toHaveBeenCalledOnce();
    expect(clipboard.text).toBe('what the user had copied earlier');
  });

  it('returns null when the clipboard did not change', async () => {
    const clipboard = fakeClipboard('unchanged');

    const selection = await captureSelectionWith(deps(clipboard, async () => {}));

    expect(selection).toBeNull();
    expect(clipboard.text).toBe('unchanged');
  });

  it('returns null when nothing was selected and the clipboard came back empty', async () => {
    const clipboard = fakeClipboard('previous');
    const copy = async () => {
      await clipboard.writeText('');
    };

    expect(await captureSelectionWith(deps(clipboard, copy))).toBeNull();
    expect(clipboard.text).toBe('previous');
  });

  it('restores the clipboard even when the copy keystroke fails', async () => {
    const clipboard = fakeClipboard('precious');
    const copy = async () => {
      throw new Error('nut-js could not reach the foreground window');
    };

    await expect(captureSelectionWith(deps(clipboard, copy))).rejects.toThrow('nut-js');
    expect(clipboard.text).toBe('precious');
  });

  it('truncates a selection larger than the snapshot allows', async () => {
    const clipboard = fakeClipboard('');
    const copy = async () => {
      await clipboard.writeText('x'.repeat(MAX_SELECTION_CHARS + 500));
    };

    const selection = await captureSelectionWith(deps(clipboard, copy));

    expect(selection).toHaveLength(MAX_SELECTION_CHARS);
  });

  it('waits the settle delay and logs the timing so the delay can be tuned', async () => {
    const clipboard = fakeClipboard('before');
    const waited: number[] = [];
    const lines: string[] = [];

    await captureSelectionWith({
      clipboard,
      sendCopy: () => clipboard.writeText('after'),
      wait: async (ms) => void waited.push(ms),
      log: (message) => void lines.push(message),
    });

    expect(waited).toEqual([COPY_SETTLE_MS]);
    expect(lines.join('\n')).toMatch(/settle/i);
  });
});
