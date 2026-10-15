import { describe, expect, it } from 'vitest';
import { IDLE_DOCK, dockMood, moveDrag, nextDock, startDrag } from './dock';

const T = '10000000-0000-4000-8000-000000000001';
const H = '10000000-0000-4000-8000-0000000000a1';

describe('the dock', () => {
  it('is idle to begin with', () => {
    expect(dockMood(IDLE_DOCK)).toBe('idle');
  });

  it('is seeing while a capture is fresh, over anything else', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(working, { type: 'seeing' }))).toBe('listening');
    expect(dockMood(nextDock(nextDock(working, { type: 'seeing' }), { type: 'seen' }))).toBe(
      'working',
    );
  });

  it('works while the companion answers, and while an expert has a task', () => {
    let dock = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(dock)).toBe('working');
    dock = nextDock(dock, { type: 'turn.completed', turnId: T });
    expect(dockMood(dock)).toBe('idle');

    dock = nextDock(dock, { type: 'handoff.progress', handoffId: H });
    expect(dockMood(dock)).toBe('working');
    dock = nextDock(dock, { type: 'handoff.finished', handoffId: H });
    expect(dockMood(dock)).toBe('done');
  });

  it('stays done until the person looks', () => {
    const done = nextDock(nextDock(IDLE_DOCK, { type: 'handoff.progress', handoffId: H }), {
      type: 'handoff.finished',
      handoffId: H,
    });
    expect(dockMood(nextDock(done, { type: 'looked' }))).toBe('idle');
  });

  it('returns the same state for events it does not read', () => {
    expect(nextDock(IDLE_DOCK, { type: 'watch.status' })).toBe(IDLE_DOCK);
  });
});

describe('moods on the dock', () => {
  const away = (dock = IDLE_DOCK) => nextDock(dock, { type: 'presence.away' });
  const wince = (dock = IDLE_DOCK) => nextDock(dock, { type: 'pet.mood', mood: 'wince' });

  it('dozes while the person is away, and wakes when they come back', () => {
    expect(dockMood(away())).toBe('dozing');
    expect(dockMood(nextDock(away(), { type: 'presence.back' }))).toBe('idle');
  });

  it('winces or cheers until the reaction is over', () => {
    expect(dockMood(wince())).toBe('wince');
    expect(dockMood(nextDock(IDLE_DOCK, { type: 'pet.mood', mood: 'cheer' }))).toBe('cheer');
    expect(dockMood(nextDock(wince(), { type: 'reacted' }))).toBe('idle');
    expect(nextDock(IDLE_DOCK, { type: 'pet.mood', mood: 'sulk' })).toBe(IDLE_DOCK);
  });

  it('keeps the order: seeing, working, a reaction, done, dozing, idle', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    const done = nextDock(nextDock(IDLE_DOCK, { type: 'handoff.progress', handoffId: H }), {
      type: 'handoff.finished',
      handoffId: H,
    });
    expect(dockMood(nextDock(wince(away(working)), { type: 'seeing' }))).toBe('listening');
    expect(dockMood(wince(away(working)))).toBe('working');
    expect(dockMood(wince(away(done)))).toBe('wince');
    expect(dockMood(away(done))).toBe('done');
    expect(dockMood(away())).toBe('dozing');
  });

  it('does not hide working while the person is away', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(away(working))).toBe('working');
  });
});

describe('something held over the pet', () => {
  it('shows the Seeing face while hovering, until it leaves or is dropped', () => {
    const hovering = nextDock(IDLE_DOCK, { type: 'dropHover' });
    expect(dockMood(hovering)).toBe('listening');
    // The drop itself ends the hover with the same event.
    expect(dockMood(nextDock(hovering, { type: 'dropLeave' }))).toBe('idle');
  });

  it('returns the same state for a repeated hover or a leave with nothing held', () => {
    const hovering = nextDock(IDLE_DOCK, { type: 'dropHover' });
    expect(nextDock(hovering, { type: 'dropHover' })).toBe(hovering);
    expect(nextDock(IDLE_DOCK, { type: 'dropLeave' })).toBe(IDLE_DOCK);
  });

  it('lets working win over a hover', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(working, { type: 'dropHover' }))).toBe('working');
  });
});

describe('dragging the pet', () => {
  it('stays a click until the pointer moves past the threshold', () => {
    const start = startDrag({ x: 100, y: 100 });
    const small = moveDrag(start, { x: 102, y: 101 });
    expect(small.step).toBeNull();
    expect(small.state.dragging).toBe(false);
  });

  it('then moves the pet by each step, from where it was', () => {
    const start = startDrag({ x: 100, y: 100 });
    const first = moveDrag(start, { x: 110, y: 95 });
    expect(first.state.dragging).toBe(true);
    expect(first.step).toEqual({ dx: 10, dy: -5 });
    const second = moveDrag(first.state, { x: 113, y: 95 });
    expect(second.step).toEqual({ dx: 3, dy: 0 });
  });
});
