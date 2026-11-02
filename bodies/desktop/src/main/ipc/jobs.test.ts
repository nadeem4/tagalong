/** Tests for the Jobs IPC, which lists Claude Code jobs and stops one through the brain. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { BrainOffline, RpcError } from '@tagalong/contract';
import { fakeIpc } from './fake-ipc';
import { registerJobsIpc } from './jobs';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup(answer: (tool: string, input?: object) => Promise<unknown> | unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  registerJobsIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

// The brain's row as it sends it: snake_case, with fields Home does not show.
const BRAIN_ROW = {
  id: 'j1',
  agent: 'claude-code',
  task: 'fix the tests',
  folder: 'C:/work/app',
  mode: 'ask',
  state: 'running',
  reason: null,
  progress: 'reading files',
  result: null,
  session_id: 's1',
  reported: false,
  started_at: '2026-10-27T10:00:00Z',
  ended_at: null,
};

const JOB = {
  id: 'j1',
  agent: 'claude-code',
  task: 'fix the tests',
  folder: 'C:/work/app',
  mode: 'ask',
  state: 'running',
  reason: null,
  progress: 'reading files',
  result: null,
  startedAt: '2026-10-27T10:00:00Z',
  endedAt: null,
  activity: false,
};

const PAGE = {
  job: 'j1',
  state: 'running',
  rev: 4,
  entries: [
    {
      rev: 4,
      seq: 1,
      at: 't',
      kind: 'command',
      text: 'npm test',
      status: 'running',
      step: 's1',
      exit: null,
    },
  ],
  more: false,
  watch: null,
};

describe('registerJobsIpc', () => {
  it('lists the brain jobs as Home shows them, in camelCase', async () => {
    const { invoke, calls } = setup(() => text({ jobs: [BRAIN_ROW] }));
    expect(await invoke(IPC.listJobs)).toEqual([JOB]);
    expect(calls).toEqual([['list_jobs', {}]]);
  });

  it('stops a job through the brain', async () => {
    const { invoke, calls } = setup(() => text({ job: 'j1', stopping: true }));
    await invoke(IPC.stopJob, 'j1');
    expect(calls).toEqual([['stop_job', { job: 'j1' }]]);
  });

  it('rejects when the brain refuses the stop', async () => {
    const { invoke } = setup(() => Promise.reject(new RpcError(-32602, 'not running')));
    await expect(invoke(IPC.stopJob, 'j1')).rejects.toBeInstanceOf(RpcError);
  });

  it('refuses a job id that is not a non-empty string, without asking the brain', async () => {
    const { invoke, calls } = setup(() => []);
    await expect(invoke(IPC.stopJob, '')).rejects.toThrow('bad job id');
    await expect(invoke(IPC.stopJob, 7)).rejects.toThrow('bad job id');
    expect(calls).toEqual([]);
  });

  it('lets an offline brain reject, so the panel can say it could not read', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.listJobs)).rejects.toBeInstanceOf(BrainOffline);
  });

  it('rejects a list the brain answered with something that is not jobs', async () => {
    const { invoke } = setup(() => text({ jobs: 'nope' }));
    await expect(invoke(IPC.listJobs)).rejects.toThrow('brain sent bad jobs');
    const other = setup(() => text([BRAIN_ROW]));
    await expect(other.invoke(IPC.listJobs)).rejects.toThrow('brain sent bad jobs');
  });

  it('maps the activity flag on a row', async () => {
    const { invoke } = setup(() => text({ jobs: [{ ...BRAIN_ROW, activity: true }] }));
    expect(await invoke(IPC.listJobs)).toEqual([{ ...JOB, activity: true }]);
  });

  it('pulls a job page by cursor through the job_activity tool', async () => {
    const { invoke, calls } = setup(() => text(PAGE));
    expect(await invoke(IPC.jobActivity, 'j1', 7)).toEqual(PAGE);
    expect(calls).toEqual([['job_activity', { job: 'j1', after_rev: 7 }]]);
  });

  it('refuses a bad job id or cursor for the activity pull, without asking the brain', async () => {
    const { invoke, calls } = setup(() => text(PAGE));
    await expect(invoke(IPC.jobActivity, '', 0)).rejects.toThrow('bad job id');
    await expect(invoke(IPC.jobActivity, 7, 0)).rejects.toThrow('bad job id');
    await expect(invoke(IPC.jobActivity, 'j1', -1)).rejects.toThrow('bad cursor');
    await expect(invoke(IPC.jobActivity, 'j1', 1.5)).rejects.toThrow('bad cursor');
    await expect(invoke(IPC.jobActivity, 'j1', '2')).rejects.toThrow('bad cursor');
    expect(calls).toEqual([]);
  });

  it('rejects an activity page whose entries are not a list', async () => {
    const { invoke } = setup(() => text({ ...PAGE, entries: 'nope' }));
    await expect(invoke(IPC.jobActivity, 'j1', 0)).rejects.toThrow('brain sent bad activity');
  });

  it('rejects an activity page without a numeric rev', async () => {
    const { invoke } = setup(() => text({ ...PAGE, rev: '7' }));
    await expect(invoke(IPC.jobActivity, 'j1', 0)).rejects.toThrow('brain sent bad activity');
  });

  it('lists the running steps for the bubble', async () => {
    const running = [{ job: 'j1', expert: 'Claude Code', text: 'npm test', at: 't' }];
    const { invoke, calls } = setup(() => text({ running }));
    expect(await invoke(IPC.runningSteps)).toEqual(running);
    expect(calls).toEqual([['job_activity', {}]]);
  });

  it('rejects running steps the brain did not send as a list', async () => {
    const { invoke } = setup(() => text({ running: 3 }));
    await expect(invoke(IPC.runningSteps)).rejects.toThrow('brain sent bad running steps');
  });

  it('handles its four channels and nothing else', () => {
    expect(setup(() => []).channels()).toEqual(
      [IPC.listJobs, IPC.stopJob, IPC.jobActivity, IPC.runningSteps].sort(),
    );
  });
});
