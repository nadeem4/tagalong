/**
 * Tests for JobPage: the cursor pull on mount and on every job_activity notice, the header
 * (state chip, Stop, back link), the failure line, the stopped clock, follow-the-end with a
 * Jump to latest pill, and the spinner's reduced-motion switch.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type JobActivityEntry, type JobRow } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { JobPage } from './job-page';

const JOB: JobRow = {
  id: 'j1',
  task: 'Fix the tests',
  folder: 'C:\\code\\app',
  mode: 'edit',
  state: 'running',
  title: null,
  startedAt: new Date(Date.now() - 5000).toISOString(),
  endedAt: null,
  closedAt: null,
  parts: [],
  activity: true,
};
const step = (seq: number, extra: Partial<JobActivityEntry> = {}): JobActivityEntry => ({
  rev: seq,
  seq,
  at: new Date().toISOString(),
  kind: 'command',
  text: `cmd ${seq}`,
  status: 'done',
  step: `s${seq}`,
  exit: null,
  part: 'p1',
  source: null,
  ...extra,
});

function renderPage(bridge: FakeHostBridge, job: JobRow = JOB, onBack = vi.fn()) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <JobPage job={job} onBack={onBack} />
    </HostBridgeProvider>,
  );
  return onBack;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('JobPage', () => {
  it('pulls from rev 0 on mount, then from the last rev on each notice', async () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [step(1), step(2)] } });
    renderPage(bridge);
    expect(await screen.findByText('$ cmd 2')).toBeInTheDocument();
    expect(bridge.activityCalls[0]).toEqual(['j1', 0]);

    bridge.activity.j1?.push(step(3));
    act(() => bridge.emitChanged('job_activity'));
    expect(await screen.findByText('$ cmd 3')).toBeInTheDocument();
    expect(bridge.activityCalls.at(-1)).toEqual(['j1', 2]);
  });

  it('fetches the next page at once while more is true', async () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [step(1), step(2)] } });
    const real = bridge.jobActivity.bind(bridge);
    bridge.jobActivity = async (job, after) => {
      const page = await real(job, after);
      return after === 0
        ? { ...page, entries: page.entries.slice(0, 1), rev: 1, more: true }
        : page;
    };
    renderPage(bridge);
    expect(await screen.findByText('$ cmd 2')).toBeInTheDocument();
    expect(bridge.activityCalls.map((c) => c[1])).toEqual([0, 1]);
  });

  it('shows the task, a state chip and Stop only while running', async () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [step(1)] } });
    renderPage(bridge);
    expect(screen.getByRole('heading', { name: 'Fix the tests' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Fix the tests' }));
    await waitFor(() => expect(bridge.jobStops).toEqual(['j1']));
  });

  it('shows no Stop for an ended job and keeps no timer running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done: JobRow = { ...JOB, state: 'done', endedAt: new Date().toISOString() };
    const bridge = createFakeHostBridge({ jobs: [done], activity: { j1: [step(1)] } });
    bridge.jobActivity = (job) =>
      Promise.resolve({
        job,
        state: 'done',
        title: null,
        startedAt: 't',
        endedAt: null,
        closedAt: null,
        parts: [],
        rev: 2,
        entries: [step(1), step(2, { kind: 'end', text: '# done', status: null, step: null })],
        more: false,
        watch: null,
      });
    renderPage(bridge, done);
    expect(await screen.findByText('# done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows Scout's watch list in the header from the first page", async () => {
    const bridge = createFakeHostBridge({
      jobs: [JOB],
      activity: { j1: [step(1)] },
      watch: { j1: [{ text: 'tests pass', done: false }] },
    });
    renderPage(bridge);
    expect(await screen.findByRole('list', { name: 'Scout is checking' })).toHaveTextContent(
      'tests pass',
    );
  });

  it('updates the list when a later page ticks an item', async () => {
    const bridge = createFakeHostBridge({
      jobs: [JOB],
      activity: { j1: [step(1)] },
      watch: { j1: [{ text: 'tests pass', done: false }] },
    });
    renderPage(bridge);
    expect(await screen.findByLabelText('not done')).toBeInTheDocument();
    bridge.watch.j1 = [{ text: 'tests pass', done: true }];
    act(() => bridge.emitChanged('job_activity'));
    expect(await screen.findByLabelText('done')).toBeInTheDocument();
  });

  it('shows nothing when Scout cleared the list', async () => {
    const bridge = createFakeHostBridge({
      jobs: [JOB],
      activity: { j1: [step(1)] },
      watch: { j1: [{ text: 'tests pass', done: false }] },
    });
    renderPage(bridge);
    expect(await screen.findByRole('list')).toBeInTheDocument();
    bridge.watch.j1 = [];
    act(() => bridge.emitChanged('job_activity'));
    await waitFor(() => expect(screen.queryByRole('list')).toBeNull());
  });

  it('goes back through the Jobs link', () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [] } });
    const onBack = renderPage(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Jobs' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('keeps the log and shows an alert when a pull fails', async () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [step(1)] } });
    renderPage(bridge);
    expect(await screen.findByText('$ cmd 1')).toBeInTheDocument();
    bridge.jobActivity = () => Promise.reject(new Error('offline'));
    act(() => bridge.emitChanged('job_activity'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
    expect(screen.getByText('$ cmd 1')).toBeInTheDocument();
  });

  it('stops following when scrolled up, shows Jump to latest, and restores it', async () => {
    const bridge = createFakeHostBridge({ jobs: [JOB], activity: { j1: [step(1)] } });
    renderPage(bridge);
    const log = await screen.findByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    const pill = await screen.findByRole('button', { name: 'Jump to latest' });

    bridge.activity.j1?.push(step(2));
    act(() => bridge.emitChanged('job_activity'));
    expect(await screen.findByText('$ cmd 2')).toBeInTheDocument();
    expect(log.scrollTop).toBe(100);

    fireEvent.click(pill);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('turns the spinner animation off for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const bridge = createFakeHostBridge({
      jobs: [JOB],
      activity: { j1: [step(1, { status: 'running' })] },
    });
    renderPage(bridge);
    expect(await screen.findByLabelText('running')).toHaveAttribute('data-motion', 'off');
  });
});
