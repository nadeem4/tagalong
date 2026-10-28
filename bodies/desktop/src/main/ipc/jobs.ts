/**
 * IPC for Home's Jobs panel: list Claude Code jobs and stop one. Both go through the brain's
 * tools (list_jobs, stop_job); the brain owns job state and refuses a stop it must not do, so a
 * refusal rejects here and the panel shows the truth again. Contains registerJobsIpc.
 */

import type { JobRow } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

// The brain's row is snake_case and carries fields Home never shows (session_id, reported).
function toRow(raw: Record<string, unknown>): JobRow {
  return {
    id: raw.id,
    agent: raw.agent,
    task: raw.task,
    folder: raw.folder,
    mode: raw.mode,
    state: raw.state,
    reason: raw.reason ?? null,
    progress: raw.progress ?? null,
    result: raw.result ?? null,
    startedAt: raw.started_at,
    endedAt: raw.ended_at ?? null,
  } as JobRow;
}

function parseRows(value: unknown): JobRow[] {
  const list = (value as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(list)) throw new Error('brain sent bad jobs');
  return list.map((raw) => toRow(raw as Record<string, unknown>));
}

export function registerJobsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.listJobs, async () => parseRows(await callJson(brain, 'list_jobs')));
  handle(IPC.stopJob, async (_event, job: unknown) => {
    // The brain would refuse an unknown id too; a page that sends a non-string is not ours.
    if (typeof job !== 'string' || job === '') throw new Error('bad job id');
    await brain.call('stop_job', { job });
  });
}
