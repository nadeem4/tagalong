/**
 * Tests for TasksView: the page title, the three tabs with counts read from the brain, the job
 * page opening in place of everything, the Held tab holding the loops panel and the Timers tab.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, type JobRow } from '../host-bridge';
import type { LoopRow, TimerRow } from '../shapes';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { TasksView } from './tasks-view';

const job = (id: string, task: string, extra: Partial<JobRow> = {}): JobRow => ({
  id,
  task,
  folder: 'C:\\code\\app',
  mode: 'edit',
  state: 'done',
  title: null,
  startedAt: '2026-10-28T09:00:00.000Z',
  endedAt: '2026-10-28T09:02:00.000Z',
  closedAt: null,
  scoutResult: null,
  parts: [],
  activity: false,
  ...extra,
});
const loop = (id: string, status: LoopRow['status'] = 'held'): LoopRow => ({
  id,
  app: 'gmail',
  title: `Loop ${id}`,
  asks: 'the deck',
  direction: 'i_owe',
  due: null,
  people: [],
  status,
});
const timer = (id: string, extra: Partial<TimerRow> = {}): TimerRow => ({
  id,
  note: `note ${id}`,
  nextAt: '2027-01-01T20:00:00+00:00',
  repeatMinutes: null,
  pending: false,
  ...extra,
});

function open(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <TasksView />
    </HostBridgeProvider>,
  );
}

describe('TasksView', () => {
  it('shows counts from the brain on the tabs', async () => {
    open(
      createFakeHostBridge({
        jobs: [job('j1', 'Fix it'), job('j2', 'Write docs')],
        loops: {
          apps: [{ id: 'gmail', name: 'Gmail', on: true }],
          loops: [loop('a'), loop('b', 'done')],
        },
        timers: [timer('t1'), timer('t2'), timer('t3')],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Jobs (2)' })).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Held (1)' })).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Timers (3)' })).toBeVisible();
  });

  it('counts follow a change the brain announces', async () => {
    const bridge = createFakeHostBridge({ timers: [timer('t1')] });
    open(bridge);
    await screen.findByRole('tab', { name: 'Timers (1)' });
    bridge.timers = [timer('t1'), timer('t2')];
    act(() => bridge.emitChanged('timers'));
    expect(await screen.findByRole('tab', { name: 'Timers (2)' })).toBeVisible();
  });

  it('opens on Jobs and keeps job pages: Watch opens, Back returns', async () => {
    open(createFakeHostBridge({ jobs: [job('j1', 'Fix it', { activity: true })] }));
    const panel = await screen.findByRole('region', { name: 'Jobs' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Watch Fix it' }));
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: /^Held/ })).toBeNull(); // the page takes everything
    expect(screen.queryByRole('heading', { name: 'Tasks', level: 1 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('region', { name: 'Jobs' })).toBeVisible();
    expect(screen.getByRole('tab', { name: /^Held/ })).toBeVisible();
  });

  it('puts the loops panel inside the Held tab and Forget still works', async () => {
    const bridge = createFakeHostBridge({
      loops: { apps: [{ id: 'gmail', name: 'Gmail', on: true }], loops: [loop('a')] },
    });
    open(bridge);
    expect(screen.queryByText('READ MY MAIL FOR LOOPS')).toBeNull();
    fireEvent.click(await screen.findByRole('tab', { name: /^Held/ }));
    expect(await screen.findByText('READ MY MAIL FOR LOOPS')).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget Loop a' }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['forget a']));
  });

  it('lists and cancels timers on the Timers tab, then reads again', async () => {
    const bridge = createFakeHostBridge({ timers: [timer('t1'), timer('t2')] });
    open(bridge);
    fireEvent.click(await screen.findByRole('tab', { name: /^Timers/ }));
    expect(await screen.findByText('note t1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel note t1' }));
    await waitFor(() => expect(bridge.cancelledTimers).toEqual(['t1']));
    await waitFor(() => expect(screen.queryByText('note t1')).toBeNull());
    expect(screen.getByText('note t2')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Timers (1)' })).toBeVisible();
  });
});
