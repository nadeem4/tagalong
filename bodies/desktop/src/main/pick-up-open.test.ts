/** Tests for openFor, the pick-up allowlist and the wait. */

import { describe, expect, it } from 'vitest';
import type { PickUpReadyParams } from '@tagalong/protocol';
import { PickUpAllowlist, PickUpWaiting, openFor } from './pick-up-open';

const ready: PickUpReadyParams = {
  text: 'Yesterday you were in ai_pet.',
  items: [
    { id: 'p1', kind: 'project', name: 'ai_pet', path: 'C:\\projects\\ai_pet', editor: 'vscode' },
    { id: 'p2', kind: 'project', name: 'web', path: 'D:\\code\\my web', editor: 'cursor' },
    { id: 'p3', kind: 'project', name: 'api', path: 'C:\\api', editor: 'other' },
    { id: 'h1', kind: 'handoff', expertName: 'Claude Code', ask: 'Fix it', state: 'stopped' },
  ],
};

describe('openFor', () => {
  it('opens VS Code and Cursor by their own links, which restore their open files', () => {
    expect(openFor(ready.items[0]!)).toEqual({
      external: 'vscode://file/C:/projects/ai_pet',
    });
    expect(openFor(ready.items[1]!)).toEqual({ external: 'cursor://file/D:/code/my%20web' });
  });

  it('opens the folder for any other editor', () => {
    expect(openFor(ready.items[2]!)).toEqual({ path: 'C:\\api' });
  });

  it('opens nothing for a hand-off', () => {
    expect(openFor(ready.items[3]!)).toBeNull();
  });
});

describe('PickUpAllowlist', () => {
  it('opens only an item of the current pick-up, by its id', () => {
    const allow = new PickUpAllowlist();
    expect(allow.open('p1')).toBeNull();
    allow.set(ready);
    expect(allow.open('p1')).toEqual({ external: 'vscode://file/C:/projects/ai_pet' });
    expect(allow.open('C:\\Windows')).toBeNull();
    expect(allow.open('h1')).toBeNull();
  });

  it('forgets the last pick-up when a new one comes, and when it is cleared', () => {
    const allow = new PickUpAllowlist();
    allow.set(ready);
    allow.set({ text: 'x', items: [ready.items[2]!] });
    expect(allow.open('p1')).toBeNull();
    expect(allow.open('p3')).toEqual({ path: 'C:\\api' });
    allow.clear();
    expect(allow.open('p3')).toBeNull();
  });
});

describe('PickUpWaiting', () => {
  it('waits on one hide only, and shows the latest pick-up once', () => {
    const waiting = new PickUpWaiting();
    const later = { text: 'later', items: [ready.items[2]!] };
    expect(waiting.hold(ready)).toBe(true);
    // A second one while the bubble is still open replaces the first: no second listener.
    expect(waiting.hold(later)).toBe(false);
    expect(waiting.release()).toBe(later);
    expect(waiting.release()).toBeNull();
  });

  it('shows nothing stale once dropped, as when pick-up is switched off', () => {
    const waiting = new PickUpWaiting();
    waiting.hold(ready);
    waiting.drop();
    expect(waiting.release()).toBeNull();
    expect(waiting.hold(ready)).toBe(true);
  });
});
