/**
 * Tests for JobsPanel: one row per Claude Code job, the state badge, Stop on running rows, the
 * expandable result and the refetch when the brain says jobs changed.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type JobRow } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { JobsPanel } from './jobs-panel';

const RUNNING: JobRow = {
  id: 'j1',
  agent: 'claude-code',
  task: 'Fix the login bug',
  folder: 'C:\\code\\app',
  mode: 'edit',
  state: 'running',
  reason: null,
  progress: 'Reading auth.ts',
  result: null,
  startedAt: '2026-10-28T09:00:00.000Z',
  endedAt: null,
};
const DONE: JobRow = {
  ...RUNNING,
  id: 'j2',
  task: 'Write the release notes',
  mode: 'read',
  state: 'done',
  progress: null,
  result: 'Notes are in CHANGELOG.md',
  endedAt: '2026-10-28T09:02:05.000Z',
};
const FAILED: JobRow = {
  ...RUNNING,
  id: 'j3',
  task: 'Run the migration',
  state: 'error',
  reason: 'Claude Code exited',
  progress: null,
  endedAt: '2026-10-28T09:00:10.000Z',
};
const STOPPED: JobRow = { ...FAILED, id: 'j4', task: 'Refactor', state: 'stopped' };

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <JobsPanel />
    </HostBridgeProvider>,
  );
}

const rows = async () =>
  within(await screen.findByRole('list', { name: 'Jobs' })).getAllByRole('listitem');

describe('JobsPanel', () => {
  it('lists one row per job with task, folder, mode, state and latest progress', async () => {
    renderPanel(createFakeHostBridge({ jobs: [RUNNING, DONE] }));
    const [running, done] = await rows();
    expect(running).toHaveTextContent('Fix the login bug');
    expect(running).toHaveTextContent('C:\\code\\app');
    expect(running).toHaveTextContent('edit');
    expect(running).toHaveTextContent('Running');
    expect(running).toHaveTextContent('Reading auth.ts');
    expect(done).toHaveTextContent('Done');
    expect(done).toHaveTextContent('2m 5s');
  });

  it('names every state in words, not only by colour', async () => {
    renderPanel(createFakeHostBridge({ jobs: [FAILED, STOPPED] }));
    const [failed, stopped] = await rows();
    expect(failed).toHaveTextContent('Error');
    expect(failed).toHaveTextContent('Claude Code exited');
    expect(stopped).toHaveTextContent('Stopped');
  });

  it('shows Stop on a running row only', async () => {
    renderPanel(createFakeHostBridge({ jobs: [RUNNING, DONE] }));
    const [running, done] = await rows();
    expect(within(running!).getByRole('button', { name: 'Stop Fix the login bug' })).toBeVisible();
    expect(within(done!).queryByRole('button', { name: /^Stop/ })).toBeNull();
  });

  it('stops the job, then reads the list again', async () => {
    const bridge = createFakeHostBridge({ jobs: [RUNNING] });
    const record = bridge.stopJob!.bind(bridge);
    // The fake only records the id; the brain would also end the job.
    bridge.stopJob = (job) => {
      bridge.jobs = [{ ...RUNNING, state: 'stopped', endedAt: '2026-10-28T09:00:30.000Z' }];
      return record(job);
    };
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Fix the login bug' }));
    await waitFor(() => expect(screen.getByText('Stopped')).toBeInTheDocument());
    expect(bridge.jobStops).toEqual(['j1']);
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
  });

  it('logs and reads again when Stop is refused', async () => {
    const bridge = createFakeHostBridge({ jobs: [RUNNING] });
    bridge.stopJob = () => Promise.reject(new Error('already ended'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    await rows();
    bridge.jobs = [DONE];
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Fix the login bug' }));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Write the release notes')).toBeInTheDocument();
    errors.mockRestore();
  });

  it('keeps a finished job’s result behind an expand control', async () => {
    renderPanel(createFakeHostBridge({ jobs: [DONE] }));
    expect(screen.queryByText('Notes are in CHANGELOG.md')).toBeNull();
    const toggle = await screen.findByRole('button', { name: 'Show result' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText('Notes are in CHANGELOG.md')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide result' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('reads again when the brain says jobs changed, and only then', async () => {
    const bridge = createFakeHostBridge({ jobs: [RUNNING] });
    renderPanel(bridge);
    await rows();
    bridge.jobs = [DONE];
    act(() => bridge.emitChanged('memory'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
    act(() => bridge.emitChanged('jobs'));
    expect(await screen.findByText('Write the release notes')).toBeInTheDocument();
  });

  it('has an empty state', async () => {
    renderPanel(createFakeHostBridge({ jobs: [] }));
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('says so when the jobs cannot be read', async () => {
    const bridge = createFakeHostBridge();
    bridge.listJobs = () => Promise.reject(new Error('brain down'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/);
    errors.mockRestore();
  });

  it('stops listening for changes when it goes away', async () => {
    const bridge = createFakeHostBridge({ jobs: [] });
    const off = vi.fn();
    bridge.onBrainChanged = () => off;
    const { unmount } = render(
      <HostBridgeProvider bridge={bridge}>
        <JobsPanel />
      </HostBridgeProvider>,
    );
    await screen.findByText(/No jobs yet/);
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it('shows nothing on a host without jobs', () => {
    const bridge = createFakeHostBridge();
    delete bridge.listJobs;
    renderPanel(bridge);
    expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
  });
});
