import { describe, expect, it } from 'vitest';
import { IDLE_DOCK, dockMood, nextDock } from './dock';

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
