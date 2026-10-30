/** Tests for the dock's mood reducer and the press-to-drag threshold. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDLE_DOCK, dockMood, moveDrag, nextDock, startDrag } from './dock';

const T = '10000000-0000-4000-8000-000000000001';
const J = '10000000-0000-4000-8000-0000000000b1';

describe('the dock', () => {
  it('is idle to begin with', () => {
    expect(dockMood(IDLE_DOCK)).toBe('idle');
  });

  it('is seeing while a capture is fresh, over anything else', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(working, { type: 'seeing' }))).toBe('listening');
    expect(dockMood(nextDock(nextDock(working, { type: 'seeing' }), { type: 'seen' }))).toBe(
      'thinking',
    );
  });

  it('thinks while the companion answers', () => {
    let dock = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(dock)).toBe('thinking');
    dock = nextDock(dock, { type: 'turn.completed', turnId: T });
    expect(dockMood(dock)).toBe('idle');
  });

  it('works on a job of its own while a background turn runs, until it ends or fails', () => {
    const job = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, background: true });
    expect(dockMood(job)).toBe('working');
    expect(dockMood(nextDock(job, { type: 'turn.completed', turnId: T }))).toBe('idle');
    expect(dockMood(nextDock(job, { type: 'turn.error', turnId: T }))).toBe('idle');
  });

  it('returns the same state for a turn without an id, or the end of a turn it never saw', () => {
    expect(nextDock(IDLE_DOCK, { type: 'turn.started', background: true })).toBe(IDLE_DOCK);
    expect(nextDock(IDLE_DOCK, { type: 'turn.completed', turnId: T })).toBe(IDLE_DOCK);
  });

  it('returns the same state for events it does not read', () => {
    expect(nextDock(IDLE_DOCK, { type: 'watch.status' })).toBe(IDLE_DOCK);
  });
});

describe('moods on the dock', () => {
  const away = (dock = IDLE_DOCK) => nextDock(dock, { type: 'presence.away' });

  it('dozes while the person is away, and wakes when they come back', () => {
    expect(dockMood(away())).toBe('dozing');
    expect(dockMood(nextDock(away(), { type: 'presence.back' }))).toBe('idle');
  });

  it('keeps the order: seeing, thinking, dozing, idle', () => {
    const working = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(away(working), { type: 'seeing' }))).toBe('listening');
    expect(dockMood(away(working))).toBe('thinking');
    expect(dockMood(away())).toBe('dozing');
  });

  it('does not hide a job while the person is away', () => {
    const job = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, background: true });
    expect(dockMood(away(job))).toBe('working');
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

  it('lets a job win over a hover', () => {
    const job = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, background: true });
    expect(dockMood(nextDock(job, { type: 'dropHover' }))).toBe('working');
  });
});

describe('reading the screen', () => {
  const T2 = '10000000-0000-4000-8000-000000000002';
  const turn = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
  const look = (dock = turn, tool = 'read_window_text', turnId = T) =>
    nextDock(dock, { type: 'turn.toolRequest', turnId, tool });
  const result = (dock: typeof IDLE_DOCK, turnId = T, tool = 'read_window_text') =>
    nextDock(dock, { type: 'turn.toolResult', turnId, tool });

  it('reads while a screen tool is in flight, and clears on its result', () => {
    expect(dockMood(look())).toBe('reading');
    expect(dockMood(result(look()))).toBe('thinking');
  });

  it('clears on the turn ending too, as an aborted turn sends no result', () => {
    expect(dockMood(nextDock(look(), { type: 'turn.completed', turnId: T }))).toBe('idle');
    expect(dockMood(nextDock(look(), { type: 'turn.error', turnId: T }))).toBe('idle');
  });

  const READS = [
    'look_at_screen',
    'look_at_display',
    'look_at_window',
    'look_closer',
    'read_window_text',
    'get_selection',
    'list_windows',
    'list_displays',
    'recall_screen',
    'what_changed',
  ];

  it.each(READS)('counts %s as reading', (tool) => {
    expect(dockMood(look(turn, tool))).toBe('reading');
  });

  // The renderer never bundles core, so the names are spelled out in dock.ts. Read core's
  // sources here so a perception tool added or renamed there fails this test.
  it('names every perception and screen memory tool core defines', () => {
    const names = (file: string) => {
      const source = readFileSync(
        new URL(`../../../../../packages/core/src/tools/builtin/${file}`, import.meta.url),
        'utf8',
      );
      return [...source.matchAll(/^export const \w+ = '(\w+)';\r?$/gm)].map((m) => m[1]);
    };
    const awareness = names('awareness.ts').filter((name) => name !== 'watch_for');
    expect([...names('perception.ts'), ...awareness].sort()).toEqual([...READS].sort());
  });

  it('changes nothing for a tool that does not read the screen, or a result never asked for', () => {
    expect(look(turn, 'remember')).toBe(turn);
    expect(result(turn, T, 'remember')).toBe(turn);
    expect(result(turn)).toBe(turn);
    expect(nextDock(turn, { type: 'turn.toolRequest', tool: 'look_at_screen' })).toBe(turn);
  });

  it('keeps reading while another turn still reads', () => {
    expect(dockMood(result(look(look(), 'look_at_window', T2)))).toBe('reading');
  });
});

describe('the activity order', () => {
  it('keeps seeing over reading, over thinking, over a job', () => {
    let dock = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: J, background: true });
    expect(dockMood(dock)).toBe('working');
    dock = nextDock(dock, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(dock)).toBe('thinking');
    dock = nextDock(dock, { type: 'turn.toolRequest', turnId: T, tool: 'look_at_screen' });
    expect(dockMood(dock)).toBe('reading');
    expect(dockMood(nextDock(dock, { type: 'seeing' }))).toBe('listening');
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
