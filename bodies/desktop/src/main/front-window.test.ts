/** Tests for the call and full-screen rule: when the front window means Scout stays quiet. */
import { describe, expect, it } from 'vitest';
import type { WindowEntry } from '@tagalong/ui/shapes';
import { callOrFullScreenInFront, isMeeting } from './front-window';

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
