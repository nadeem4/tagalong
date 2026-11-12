/** Tests for the dock's mood reducer and the press-to-drag threshold. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDLE_DOCK, dockMood, moveDrag, nextDock, startDrag } from './dock';

const T = '10000000-0000-4000-8000-000000000001';
const J = '10000000-0000-4000-8000-0000000000b1';

describe('listening to the mic', () => {
  it('listens while speech is heard, below short reactions but above thinking', () => {
    expect(dockMood(IDLE_DOCK, true)).toBe('listening');
    const thinking = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T });
    expect(dockMood(thinking, true)).toBe('listening');
    expect(dockMood(nextDock(IDLE_DOCK, { type: 'poke' }), true)).toBe('happy');
    expect(dockMood(IDLE_DOCK, false)).toBe('idle');
  });
});

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
    const failed = nextDock(job, { type: 'turn.error', turnId: T });
    // The failure plays as a short error reaction, then the dock is idle again.
    expect(dockMood(failed)).toBe('error');
    expect(dockMood(nextDock(failed, { type: 'flashEnd', id: failed.flash?.id ?? 0 }))).toBe(
      'idle',
    );
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
    const failed = nextDock(look(), { type: 'turn.error', turnId: T });
    expect(dockMood(nextDock(failed, { type: 'flashEnd', id: failed.flash?.id ?? 0 }))).toBe(
      'idle',
    );
  });

  const READS = ['list_windows', 'read_window_text', 'look_at_window'];

  it.each(READS)('counts %s as reading', (tool) => {
    expect(dockMood(look(turn, tool))).toBe('reading');
  });

  // The renderer never bundles main, so the names are spelled out in dock.ts. Read the
  // desktop's declared body tools here so a screen tool added or renamed there fails this test.
  it('names every screen-reading tool the desktop declares, and no other', () => {
    const source = readFileSync(new URL('../../main/brain/body-tools.ts', import.meta.url), 'utf8');
    const declared = [...source.matchAll(/^\s{4}name: '(\w+)',/gm)].map((m) => m[1]);
    // open_url, install_ocr_language and the file tools (list_files, move_file, ...) do not
    // read the screen.
    const notScreen = ['open_url', 'install_ocr_language'];
    const screen = declared.filter(
      (name) => !notScreen.includes(name ?? '') && !/_files?$/.test(name ?? ''),
    );
    expect(screen.sort()).toEqual([...READS].sort());
    for (const tool of ['recall', 'open_url']) {
      expect(dockMood(look(turn, tool))).toBe('thinking');
    }
  });

  it('changes nothing for a tool that does not read the screen, or a result never asked for', () => {
    expect(look(turn, 'remember')).toBe(turn);
    expect(result(turn, T, 'remember')).toBe(turn);
    expect(result(turn)).toBe(turn);
    expect(nextDock(turn, { type: 'turn.toolRequest', tool: 'recall' })).toBe(turn);
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
    dock = nextDock(dock, { type: 'turn.toolRequest', turnId: T, tool: 'look_at_window' });
    expect(dockMood(dock)).toBe('reading');
    expect(dockMood(nextDock(dock, { type: 'seeing' }))).toBe('listening');
  });
});

describe('speaking', () => {
  it('speaks while the voice plays, over thinking and a job, under reading and seeing', () => {
    let dock = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: J, background: true });
    dock = nextDock(dock, { type: 'turn.started', turnId: T, petId: 'scout' });
    dock = nextDock(dock, { type: 'speech.started' });
    expect(dockMood(dock)).toBe('speaking');
    expect(
      dockMood(nextDock(dock, { type: 'turn.toolRequest', turnId: T, tool: 'look_at_window' })),
    ).toBe('reading');
    expect(dockMood(nextDock(dock, { type: 'seeing' }))).toBe('listening');
    expect(dockMood(nextDock(dock, { type: 'speech.ended' }))).toBe('thinking');
  });

  it('returns the same state for a repeated start or an end with nothing playing', () => {
    const on = nextDock(IDLE_DOCK, { type: 'speech.started' });
    expect(nextDock(on, { type: 'speech.started' })).toBe(on);
    expect(nextDock(IDLE_DOCK, { type: 'speech.ended' })).toBe(IDLE_DOCK);
  });
});

describe('jobs from the list', () => {
  const rows = (...states: string[]) => ({
    type: 'jobs',
    jobs: states.map((state, i) => ({ id: `j${i}`, state })),
  });

  it('works while any job runs, and stops when none does', () => {
    const running = nextDock(IDLE_DOCK, rows('running', 'done'));
    expect(dockMood(running)).toBe('working');
    expect(dockMood(nextDock(running, rows('done', 'done')))).toBe('celebrating');
  });

  it('celebrates a job that finished, grieves a stopped one, and flags a failed one', () => {
    const running = nextDock(IDLE_DOCK, rows('running'));
    expect(dockMood(nextDock(running, rows('done')))).toBe('celebrating');
    expect(dockMood(nextDock(running, rows('error')))).toBe('error');
    expect(dockMood(nextDock(running, rows('stopped')))).toBe('sad');
  });

  it('shows nothing for jobs that were already finished when first listed', () => {
    expect(dockMood(nextDock(IDLE_DOCK, rows('done', 'error', 'stopped')))).toBe('idle');
  });

  it('shows a job finishing only once', () => {
    const done = nextDock(nextDock(IDLE_DOCK, rows('running')), rows('done'));
    expect(dockMood(nextDock({ ...done, flash: null }, rows('done')))).toBe('idle');
  });
});

describe('short reactions', () => {
  it('flags a turn that failed, and a brain that was lost', () => {
    const turn = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(turn, { type: 'turn.error', turnId: T }))).toBe('error');
  });

  it('is sad when the person stopped a turn, and idle when it just completed', () => {
    const turn = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(
      dockMood(nextDock(turn, { type: 'turn.completed', turnId: T, stopReason: 'aborted' })),
    ).toBe('sad');
    expect(dockMood(nextDock(turn, { type: 'turn.completed', turnId: T, stopReason: 'end' }))).toBe(
      'idle',
    );
  });

  it('is surprised when Scout speaks up on its own', () => {
    expect(dockMood(nextDock(IDLE_DOCK, { type: 'pet.remark' }))).toBe('surprised');
  });

  it('is happy when the person clicks it', () => {
    expect(dockMood(nextDock(IDLE_DOCK, { type: 'poke' }))).toBe('happy');
  });

  it('wins over everything, and ends only for its own flash', () => {
    const seeing = nextDock(IDLE_DOCK, { type: 'seeing' });
    const happy = nextDock(seeing, { type: 'poke' });
    expect(dockMood(happy)).toBe('happy');
    expect(dockMood(nextDock(happy, { type: 'flashEnd', id: happy.flash!.id + 1 }))).toBe('happy');
    expect(dockMood(nextDock(happy, { type: 'flashEnd', id: happy.flash!.id }))).toBe('listening');
  });

  it('gives each flash its own id, so a second one restarts the timer', () => {
    const one = nextDock(IDLE_DOCK, { type: 'poke' });
    expect(nextDock(one, { type: 'poke' }).flash!.id).not.toBe(one.flash!.id);
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
