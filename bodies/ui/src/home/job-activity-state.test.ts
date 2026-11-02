/** Tests for the job log reducer: pages fold into one list ordered by seq, updates replace in place. */

import { describe, expect, it } from 'vitest';
import type { JobActivityEntry, JobActivityPage } from '../host-bridge';
import { applyPage, emptyLog } from './job-activity-state';

const entry = (
  seq: number,
  rev: number,
  extra: Partial<JobActivityEntry> = {},
): JobActivityEntry => ({
  rev,
  seq,
  at: '2026-11-02T10:00:00.000Z',
  kind: 'command',
  text: `step ${seq}`,
  status: 'running',
  step: `s${seq}`,
  exit: null,
  ...extra,
});
const page = (rev: number, entries: JobActivityEntry[], state = 'running'): JobActivityPage => ({
  job: 'j1',
  state,
  rev,
  entries,
  more: false,
  watch: null,
});

describe('applyPage', () => {
  it('starts empty at rev 0', () => {
    expect(emptyLog()).toEqual({ entries: [], rev: 0, state: 'running' });
  });

  it('appends pages in seq order', () => {
    const log = applyPage(applyPage(emptyLog(), page(2, [entry(2, 2)])), page(3, [entry(1, 3)]));
    expect(log.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('replaces an entry with the same seq in place', () => {
    const first = applyPage(emptyLog(), page(2, [entry(1, 1), entry(2, 2)]));
    const next = applyPage(first, page(3, [entry(2, 3, { status: 'done' })]));
    expect(next.entries).toHaveLength(2);
    expect(next.entries[1]?.status).toBe('done');
  });

  it('sorts the dropped marker first', () => {
    const log = applyPage(emptyLog(), page(5, [entry(3, 4), entry(0, 5, { kind: 'other' })]));
    expect(log.entries[0]?.seq).toBe(0);
  });

  it('never moves rev backwards and takes the job state', () => {
    const log = applyPage(applyPage(emptyLog(), page(7, [entry(1, 7)])), page(3, [], 'done'));
    expect(log.rev).toBe(7);
    expect(log.state).toBe('done');
  });

  it('is idempotent', () => {
    const p = page(2, [entry(1, 1), entry(2, 2)]);
    const once = applyPage(emptyLog(), p);
    expect(applyPage(once, p)).toEqual(once);
  });
});
