/**
 * Tests for TasksView: the page title, the three tabs with counts read from the brain, the job
 * page opening in place of everything, the Waiting tab holding the news and the loops panel and the Timers tab.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, type JobRow } from '../host-bridge';
import type { LoopRow, TaskRow, TimerRow, WaitingEvent } from '../shapes';
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
const waiting = (id: string): WaitingEvent => ({
  id,
  ageS: 60,
  gaveUp: false,
  gist: `News ${id}`,
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
        waiting: [waiting('e1'), waiting('e2')],
        timers: [timer('t1'), timer('t2'), timer('t3')],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Jobs (2)' })).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Waiting (2)' })).toBeVisible();
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

  it('the Waiting count and list follow a change the brain announces', async () => {
    const bridge = createFakeHostBridge({ waiting: [waiting('e1')] });
    open(bridge);
    fireEvent.click(await screen.findByRole('tab', { name: 'Waiting (1)' }));
    bridge.waiting = [waiting('e1'), waiting('e2')];
    act(() => bridge.emitChanged('events'));
    expect(await screen.findByRole('tab', { name: 'Waiting (2)' })).toBeVisible();
    expect(await screen.findByText('News e2')).toBeVisible();
  });

  it('opens on Jobs and keeps job pages: Watch opens, Back returns', async () => {
    open(createFakeHostBridge({ jobs: [job('j1', 'Fix it', { activity: true })] }));
    const panel = await screen.findByRole('region', { name: 'Jobs' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Watch Fix it' }));
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: /^Waiting/ })).toBeNull(); // the page takes everything
    expect(screen.queryByRole('heading', { name: 'Tasks', level: 1 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('region', { name: 'Jobs' })).toBeVisible();
    expect(screen.getByRole('tab', { name: /^Waiting/ })).toBeVisible();
  });

  it('lists the waiting news when the Waiting tab opens', async () => {
    open(createFakeHostBridge({ waiting: [waiting('e1')] }));
    fireEvent.click(await screen.findByRole('tab', { name: /^Waiting/ }));
    expect(await screen.findByText('News e1')).toBeVisible();
  });

  it('puts the loops panel inside the Waiting tab and Forget still works', async () => {
    const bridge = createFakeHostBridge({
      loops: {
        apps: [{ id: 'gmail', name: 'Gmail', on: true }],
        loops: [loop('a')],
        openItems: [],
      },
    });
    open(bridge);
    expect(screen.queryByText('Read my mail for loops')).toBeNull();
    fireEvent.click(await screen.findByRole('tab', { name: /^Waiting/ }));
    expect(await screen.findByText('Read my mail for loops')).toBeVisible();
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

describe('TasksView task list', () => {
  const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow => ({
    id,
    kind: 'watch',
    state: 'open',
    title: `Task ${id}`,
    source: 'timer:w1',
    chain: [],
    createdAt: '2026-11-17T08:00:00+00:00',
    endedAt: null,
    ...extra,
  });

  it('lists the tasks on its own tab and stops one, then reads again', async () => {
    const bridge = createFakeHostBridge({ tasks: [task('a')] });
    open(bridge);
    fireEvent.click(await screen.findByRole('tab', { name: 'All tasks (1)' }));
    bridge.tasks = [];
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Task a' }));
    await waitFor(() => expect(bridge.taskStops).toEqual(['a']));
    expect(await screen.findByRole('tab', { name: 'All tasks (0)' })).toBeVisible();
  });

  it('shows no Ask task', async () => {
    open(createFakeHostBridge({ tasks: [task('a'), task('k', { kind: 'ask', title: 'Hello' })] }));
    fireEvent.click(await screen.findByRole('tab', { name: 'All tasks (1)' }));
    expect(screen.queryByText('Hello')).toBeNull();
  });
});
