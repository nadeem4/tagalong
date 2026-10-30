/** Tests for the status marks holder: the top mark by order, the time limit and change events. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusMark } from '@tagalong/ui/shapes';
import { AlwaysListening } from './always-listening';
import {
  LISTENING_MARK_MS,
  SAY_NAME_MARK_MS,
  StatusMarks,
  markBrainLink,
  markListening,
  setPanelMark,
} from './status-marks';

describe('StatusMarks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the top mark by the shared order', () => {
    const marks = new StatusMarks();
    expect(marks.top()).toBeNull();
    marks.set({ id: 'listening-on' });
    marks.set({ id: 'mic-busy' });
    expect(marks.top()).toEqual({ id: 'mic-busy' });
    marks.clear('mic-busy');
    expect(marks.top()).toEqual({ id: 'listening-on' });
  });

  it('clears a mark when its time runs out, and a later set restarts the time', () => {
    const marks = new StatusMarks();
    marks.set({ id: 'listening-on' }, 8_000);
    vi.advanceTimersByTime(5_000);
    marks.set({ id: 'listening-on' }, 8_000);
    vi.advanceTimersByTime(5_000);
    expect(marks.top()).toEqual({ id: 'listening-on' });
    vi.advanceTimersByTime(3_000);
    expect(marks.top()).toBeNull();
  });

  it('a set with no time limit keeps the mark, even after an earlier timed set', () => {
    const marks = new StatusMarks();
    marks.set({ id: 'listening-on' }, 1_000);
    marks.set({ id: 'listening-on' });
    vi.advanceTimersByTime(5_000);
    expect(marks.top()).toEqual({ id: 'listening-on' });
  });

  it('tells its listener the new top mark only when it changes', () => {
    const seen: (StatusMark | null)[] = [];
    const marks = new StatusMarks((top) => seen.push(top));
    marks.set({ id: 'brain-offline' });
    marks.set({ id: 'listening-on' });
    marks.clear('mic-busy');
    marks.clear('brain-offline');
    marks.clear('listening-on');
    expect(seen).toEqual([{ id: 'brain-offline' }, { id: 'listening-on' }, null]);
  });
});

describe('markListening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Listening for a few seconds when it starts on, and again on each switch on', () => {
    const marks = new StatusMarks();
    const listening = new AlwaysListening(true);
    markListening(marks, listening);
    expect(marks.top()).toEqual({ id: 'listening-on' });
    vi.advanceTimersByTime(LISTENING_MARK_MS);
    expect(marks.top()).toBeNull();
    listening.set(false);
    listening.set(true);
    expect(marks.top()).toEqual({ id: 'listening-on' });
  });

  it('clears it when switched off, and shows Not listening while paused', () => {
    const marks = new StatusMarks();
    const listening = new AlwaysListening(false);
    markListening(marks, listening);
    expect(marks.top()).toBeNull();
    listening.set(true);
    listening.setPaused(true);
    expect(marks.top()).toEqual({ id: 'listening-paused' });
    listening.setPaused(false);
    expect(marks.top()).toEqual({ id: 'listening-on' });
    listening.setPaused(true);
    listening.set(false);
    expect(marks.top()).toBeNull();
  });

  it('a pause with listening off shows nothing', () => {
    const marks = new StatusMarks();
    const listening = new AlwaysListening(false);
    markListening(marks, listening);
    listening.setPaused(true);
    expect(marks.top()).toBeNull();
  });
});

describe('setPanelMark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets and clears the mic marks the panel knows about', () => {
    const marks = new StatusMarks();
    setPanelMark(marks, 'mic-busy', true);
    expect(marks.top()).toEqual({ id: 'mic-busy' });
    setPanelMark(marks, 'mic-busy', false);
    expect(marks.top()).toBeNull();
  });

  it('shows Say “Scout” for a few seconds only', () => {
    const marks = new StatusMarks();
    setPanelMark(marks, 'say-name', true);
    expect(marks.top()).toEqual({ id: 'say-name' });
    vi.advanceTimersByTime(SAY_NAME_MARK_MS);
    expect(marks.top()).toBeNull();
  });

  it('refuses any other mark, so a window cannot claim Scout can think', () => {
    const marks = new StatusMarks();
    marks.set({ id: 'brain-offline' });
    expect(() => setPanelMark(marks, 'brain-offline', false)).toThrow();
    expect(() => setPanelMark(marks, 'nope', true)).toThrow();
    expect(() => setPanelMark(marks, 'mic-busy', 'yes')).toThrow();
    expect(marks.top()).toEqual({ id: 'brain-offline' });
  });
});

describe('markBrainLink', () => {
  it('shows Offline while the brain is down, and nothing once it is online', () => {
    const marks = new StatusMarks();
    markBrainLink(marks, 'offline');
    expect(marks.top()).toEqual({ id: 'brain-offline' });
    markBrainLink(marks, 'connecting');
    expect(marks.top()).toEqual({ id: 'brain-offline' });
    markBrainLink(marks, 'online');
    expect(marks.top()).toBeNull();
  });

  it('swaps Offline for the update mark when the brain is too new', () => {
    const marks = new StatusMarks();
    markBrainLink(marks, 'offline');
    markBrainLink(marks, 'outdated');
    expect(marks.top()).toEqual({ id: 'brain-outdated' });
    markBrainLink(marks, 'online');
    expect(marks.top()).toBeNull();
  });
});
