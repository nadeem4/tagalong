/** Tests for the screenshot of one listed window. */

import { describe, expect, it, vi } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import { lookAtWindowWith } from './window-shot';

const IMAGE = { base64: 'cG5n', width: 800, height: 600 };

const window = (overrides: Partial<WindowEntry>): WindowEntry => ({
  id: 'w-222',
  processName: 'msedge',
  title: 'Dashboard - Microsoft Edge',
  state: 'background',
  browser: true,
  ...overrides,
});

function deps(windows: WindowEntry[]) {
  const captureWindowImage = vi.fn(async () => IMAGE);
  return { listWindows: async () => windows, captureWindowImage };
}

describe('lookAtWindowWith', () => {
  it('photographs a listed window that sits behind others', async () => {
    const d = deps([window({})]);

    const answer = await lookAtWindowWith(d, { windowId: 'w-222', maxLongSide: 1568 });

    expect(d.captureWindowImage).toHaveBeenCalledWith(222, 1568);
    expect(answer).toEqual({
      windowId: 'w-222',
      image: { mime: 'image/png', ...IMAGE },
    });
  });

  it('never photographs a blind spot, and says which rule refused', async () => {
    const blocked = { rule: 'titlePattern' as const, entry: '.env' };
    const d = deps([window({ blocked })]);

    const answer = await lookAtWindowWith(d, { windowId: 'w-222', maxLongSide: 1568 });

    expect(d.captureWindowImage).not.toHaveBeenCalled();
    expect(answer.image).toBeUndefined();
    expect(answer.blocked).toEqual(blocked);
  });

  it('explains that a minimized window has nothing to photograph', async () => {
    const d = deps([window({ state: 'minimized' })]);

    const answer = await lookAtWindowWith(d, { windowId: 'w-222', maxLongSide: 1568 });

    expect(d.captureWindowImage).not.toHaveBeenCalled();
    expect(answer.notes?.join(' ')).toMatch(/minimized/i);
    expect(answer.notes?.join(' ')).toMatch(/read_window_text/);
  });

  it('answers honestly for a window id it never issued', async () => {
    const answer = await lookAtWindowWith(deps([]), { windowId: 'w-999', maxLongSide: 1568 });
    expect(answer.image).toBeUndefined();
    expect(answer.notes?.join(' ')).toMatch(/no window w-999/i);
  });
});
