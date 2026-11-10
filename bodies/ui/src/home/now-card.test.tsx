/**
 * Tests for NowCard: what is live on the Tasks page. Waiting asks first (Deny, Always, Allow),
 * then running jobs with their live step and a ticking clock, mail being read, and timers about
 * to fire. Only the clock and Date are faked, so promises and waitFor keep working.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type JobRow, type RunningStep } from '../host-bridge';
import type { TimerRow, TurnEvent } from '../shapes';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { NowCard } from './now-card';

const NOW = new Date('2026-11-10T12:00:00.000Z');

const confirm = (approvalId: string, extra: Record<string, unknown> = {}): TurnEvent =>
  ({
    type: 'connector.confirm',
    approvalId,
    turnId: '',
    petId: 'scout',
    app: 'gmail',
    tool: 'send_message',
    summary: `Send the reply ${approvalId}`,
    options: ['allow', 'always', 'deny'],
    ...extra,
  }) as TurnEvent;

const job = (extra: Partial<JobRow> = {}): JobRow => ({
  id: 'j1',
  task: 'Fix the login bug',
  folder: 'C:\\code\\app',
  mode: 'edit',
  state: 'running',
  title: null,
  startedAt: new Date(NOW.getTime() - 125_000).toISOString(), // 2m 5s ago
  endedAt: null,
  closedAt: null,
  scoutResult: null,
  parts: [],
  activity: false,
  ...extra,
});
const step = (extra: Partial<RunningStep> = {}): RunningStep => ({
  job: 'j1',
  expert: 'claude-code',
  text: 'Reading auth.ts',
  at: NOW.toISOString(),
  ...extra,
});
const timer = (id: string, minutes: number): TimerRow => ({
  id,
  note: `note ${id}`,
  nextAt: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
  repeatMinutes: null,
  pending: false,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

function open(bridge: FakeHostBridge, onOpenJob: (id: string) => void = () => undefined) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <NowCard onOpenJob={onOpenJob} />
    </HostBridgeProvider>,
  );
}

describe('NowCard', () => {
  it('shows a waiting ask first, with Deny, Always and Allow answering the brain', async () => {
    const bridge = createFakeHostBridge({
      openConfirms: [confirm('a1')],
      jobs: [job()],
    });
    open(bridge);
    const ask = await screen.findByText('Send the reply a1');
    const rows = document.querySelectorAll('.now__row');
    expect(rows[0]).toContainElement(ask);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(bridge.approvals).toEqual([{ approvalId: 'a1', decision: 'once' }]);
    await waitFor(() => expect(screen.queryByText('Send the reply a1')).toBeNull());
  });

  it('maps Always and Deny', async () => {
    const bridge = createFakeHostBridge({ openConfirms: [confirm('a1'), confirm('a2')] });
    open(bridge);
    const first = (await screen.findByText('Send the reply a1')).closest(
      '.now__row',
    ) as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: 'Always' }));
    const second = (await screen.findByText('Send the reply a2')).closest(
      '.now__row',
    ) as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Deny' }));
    expect(bridge.approvals).toEqual([
      { approvalId: 'a1', decision: 'always' },
      { approvalId: 'a2', decision: 'deny' },
    ]);
  });

  it('has no Always when the ask does not offer it', async () => {
    open(createFakeHostBridge({ openConfirms: [confirm('a1', { options: ['allow', 'deny'] })] }));
    await screen.findByText('Send the reply a1');
    expect(screen.queryByRole('button', { name: 'Always' })).toBeNull();
  });

  it('a live ask arrives, and a dismiss removes it without an error', async () => {
    const bridge = createFakeHostBridge();
    open(bridge);
    await screen.findByText('Nothing is running right now.');
    act(() => bridge.emit(confirm('a9')));
    expect(await screen.findByText('Send the reply a9')).toBeVisible();
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a9' } as TurnEvent));
    await waitFor(() => expect(screen.queryByText('Send the reply a9')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not show an expert question or an ask with no allow option', async () => {
    open(
      createFakeHostBridge({
        openConfirms: [
          confirm('q1', { question: true, options: [] }),
          confirm('m1', { options: ['plan', 'edit'] }),
        ],
      }),
    );
    await screen.findByText('Nothing is running right now.');
    expect(screen.queryByText('Send the reply q1')).toBeNull();
    expect(screen.queryByText('Send the reply m1')).toBeNull();
  });

  it('shows a running job with its live step and a clock that ticks, Open and Stop', async () => {
    const bridge = createFakeHostBridge({ jobs: [job()], runningSteps: [step()] });
    const onOpenJob = vi.fn();
    open(bridge, onOpenJob);
    expect(await screen.findByText('Fix the login bug')).toBeVisible();
    expect(screen.getByText('Reading auth.ts')).toBeVisible();
    expect(screen.getByText('2m 5s')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText('3m 10s')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenJob).toHaveBeenCalledWith('j1');
    const reads = vi.spyOn(bridge, 'listJobs');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(bridge.jobStops).toEqual(['j1']);
    await act(async () => undefined); // flush the read that follows the stop
    expect(reads).toHaveBeenCalled();
  });

  it('prefers a job title to the task text', async () => {
    open(createFakeHostBridge({ jobs: [job({ title: 'Login fix' })] }));
    expect(await screen.findByText('Login fix')).toBeVisible();
    expect(screen.queryByText('Fix the login bug')).toBeNull();
  });

  it('leaves finished jobs out', async () => {
    open(createFakeHostBridge({ jobs: [job({ state: 'done', endedAt: NOW.toISOString() })] }));
    expect(await screen.findByText('Nothing is running right now.')).toBeVisible();
  });

  it('says mail is being read only when the switch is on and not stalled', async () => {
    open(
      createFakeHostBridge({
        loops: {
          apps: [
            { id: 'gmail', name: 'Gmail', on: true },
            { id: 'outlook', name: 'Outlook', on: true, unreadSince: NOW.toISOString() },
            { id: 'fast', name: 'Fastmail', on: false },
          ],
          loops: [],
        },
      }),
    );
    expect(await screen.findByText('Reading Gmail mail')).toBeVisible();
    expect(screen.queryByText('Reading Outlook mail')).toBeNull();
    expect(screen.queryByText('Reading Fastmail mail')).toBeNull();
  });

  it('shows a timer within the hour and not a later one', async () => {
    open(createFakeHostBridge({ timers: [timer('soon', 20), timer('later', 120)] }));
    expect(await screen.findByText('note soon')).toBeVisible();
    expect(screen.getByText('in 20 min')).toBeVisible();
    expect(screen.queryByText('note later')).toBeNull();
  });

  it('says nothing is running when nothing is live', async () => {
    open(createFakeHostBridge());
    expect(await screen.findByText('Nothing is running right now.')).toBeVisible();
  });

  it('one failed read does not hide the other rows', async () => {
    const bridge = createFakeHostBridge({ timers: [timer('soon', 5)] });
    vi.spyOn(bridge, 'listJobs').mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    open(bridge);
    expect(await screen.findByText('note soon')).toBeVisible();
  });
});
