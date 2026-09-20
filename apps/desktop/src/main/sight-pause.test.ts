import { describe, expect, it, vi } from 'vitest';

import { SightPause } from './sight-pause';

describe('SightPause', () => {
  it('starts running, because a pet that boots blind looks broken', () => {
    expect(new SightPause().paused).toBe(false);
  });

  it('toggles and reports the state it moved to', () => {
    const pause = new SightPause();

    expect(pause.toggle()).toBe(true);
    expect(pause.paused).toBe(true);
    expect(pause.toggle()).toBe(false);
    expect(pause.paused).toBe(false);
  });

  it('sets a state directly, for the tray item that shows a checkmark', () => {
    const pause = new SightPause();

    pause.set(true);
    expect(pause.paused).toBe(true);
    pause.set(true);
    expect(pause.paused).toBe(true);
  });

  it('tells listeners when the state changes', () => {
    const pause = new SightPause();
    const seen: boolean[] = [];
    pause.onChange((paused) => seen.push(paused));

    pause.toggle();
    pause.toggle();

    expect(seen).toEqual([true, false]);
  });

  it('stays quiet when a set does not change anything', () => {
    // The tray rebuilds its menu on every change. Firing for a set that changed nothing
    // would rebuild it on every click of an already-checked item.
    const pause = new SightPause();
    const listener = vi.fn();
    pause.onChange(listener);

    pause.set(false);
    expect(listener).not.toHaveBeenCalled();

    pause.set(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells every listener, so the avatar and the tray cannot disagree', () => {
    const pause = new SightPause();
    const avatar = vi.fn();
    const tray = vi.fn();
    pause.onChange(avatar);
    pause.onChange(tray);

    pause.toggle();

    expect(avatar).toHaveBeenCalledWith(true);
    expect(tray).toHaveBeenCalledWith(true);
  });

  it('stops telling a listener that unsubscribed', () => {
    const pause = new SightPause();
    const listener = vi.fn();
    const off = pause.onChange(listener);

    off();
    pause.toggle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying the others when one listener throws', () => {
    // A renderer that has already been destroyed throws on send. That must not leave the
    // tray showing "Pause sight" unchecked while sight is actually paused.
    const pause = new SightPause();
    const survivor = vi.fn();
    pause.onChange(() => {
      throw new Error('this window is gone');
    });
    pause.onChange(survivor);

    expect(() => pause.toggle()).not.toThrow();
    expect(survivor).toHaveBeenCalledWith(true);
    expect(pause.paused).toBe(true);
  });
});
