/** Tests for the status marks holder: the top mark by order, the time limit and change events. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusMark } from '@tagalong/protocol';
import { AlwaysListening } from './always-listening';
import { LISTENING_MARK_MS, StatusMarks, clearBrainMarks, markListening } from './status-marks';

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
    marks.set({ id: 'brain-no-key' });
    expect(marks.top()).toEqual({ id: 'brain-no-key' });
    marks.clear('brain-no-key');
    expect(marks.top()).toEqual({ id: 'listening-on' });
  });

  it('replaces a mark set again with the same id', () => {
    const marks = new StatusMarks();
    marks.set({ id: 'ears-loading', percent: 10 });
    marks.set({ id: 'ears-loading', percent: 40 });
    expect(marks.top()).toEqual({ id: 'ears-loading', percent: 40 });
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

  it('tells listeners the new top mark only when it changes', () => {
    const marks = new StatusMarks();
    const seen: (StatusMark | null)[] = [];
    marks.onChange((top) => seen.push(top));
    marks.set({ id: 'brain-signed-out' });
    marks.set({ id: 'listening-on' });
    marks.clear('ears-failed');
    marks.clear('brain-signed-out');
    marks.clear('listening-on');
    expect(seen).toEqual([{ id: 'brain-signed-out' }, { id: 'listening-on' }, null]);
  });

  it('keeps going when a listener throws', () => {
    const marks = new StatusMarks();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seen: unknown[] = [];
    marks.onChange(() => {
      throw new Error('gone');
    });
    marks.onChange((top) => seen.push(top));
    marks.set({ id: 'stopped' });
    expect(seen).toEqual([{ id: 'stopped' }]);
    warn.mockRestore();
  });

  it('stops telling a listener once it unsubscribes', () => {
    const marks = new StatusMarks();
    const seen: unknown[] = [];
    const off = marks.onChange((top) => seen.push(top));
    off();
    marks.set({ id: 'stopped' });
    expect(seen).toEqual([]);
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

  it('clears it when switched off, and leaves it alone for a pause', () => {
    const marks = new StatusMarks();
    const listening = new AlwaysListening(false);
    markListening(marks, listening);
    expect(marks.top()).toBeNull();
    listening.set(true);
    listening.setPaused(true);
    expect(marks.top()).toEqual({ id: 'listening-on' });
    listening.set(false);
    expect(marks.top()).toBeNull();
  });
});

describe('clearBrainMarks', () => {
  it('clears every brain mark and nothing else', () => {
    const marks = new StatusMarks();
    marks.set({ id: 'brain-signed-out' });
    marks.set({ id: 'brain-no-key' });
    marks.set({ id: 'listening-on' });
    clearBrainMarks(marks);
    expect(marks.top()).toEqual({ id: 'listening-on' });
  });
});
