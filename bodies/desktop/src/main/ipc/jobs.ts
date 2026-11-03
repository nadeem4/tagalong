/**
 * IPC for Home's Jobs panel: list Claude Code jobs, stop one, and read a job's steps. All go
 * through the brain's tools (list_jobs, stop_job, job_activity); the brain owns job state and
 * refuses a stop it must not do, so a refusal rejects here and the panel shows the truth again.
 * Contains registerJobsIpc.
 */

import type { JobActivityPage, JobPartRow, JobRow, RunningStep } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

// The brain's row is snake_case and carries fields Home never shows (session_id_known, watch).
function toPart(raw: Record<string, unknown>): JobPartRow {
  return {
    id: raw.id,
    expert: raw.expert,
    state: raw.state,
    reason: raw.reason ?? null,
    progress: raw.progress ?? null,
    result: raw.result ?? null,
    startedAt: raw.started_at,
    endedAt: raw.ended_at ?? null,
  } as JobPartRow;
}

function toRow(raw: Record<string, unknown>): JobRow {
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  return {
    id: raw.id,
    task: raw.task,
    folder: raw.folder,
    mode: raw.mode,
    state: raw.state,
    title: raw.title ?? null,
    startedAt: raw.started_at,
    endedAt: raw.ended_at ?? null,
    closedAt: raw.closed_at ?? null,
    scoutResult: raw.scout_result ?? null,
    parts: parts.map((part) => toPart(part as Record<string, unknown>)),
    activity: raw.activity === true,
  } as JobRow;
}

function parseRows(value: unknown): JobRow[] {
  const list = (value as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(list)) throw new Error('brain sent bad jobs');
  return list.map((raw) => toRow(raw as Record<string, unknown>));
}

// The page's job times and part rows are snake_case on the wire, camelCase for the UI; the
// rest of its keys are single words and pass through once its shape is checked.
function parsePage(value: unknown): JobActivityPage {
  const page = value as Record<string, unknown> | null;
  if (!Array.isArray(page?.entries) || typeof page?.rev !== 'number') {
    throw new Error('brain sent bad activity');
  }
  const { started_at, ended_at, closed_at, parts, ...rest } = page;
  const list = Array.isArray(parts) ? (parts as Record<string, unknown>[]) : [];
  return {
    ...rest,
    startedAt: started_at,
    endedAt: ended_at ?? null,
    closedAt: closed_at ?? null,
    parts: list.map(({ started_at: s, ended_at: e, ...part }) => ({
      ...part,
      startedAt: s,
      endedAt: e ?? null,
    })),
  } as JobActivityPage;
}

function parseRunning(value: unknown): RunningStep[] {
  const list = (value as { running?: unknown } | null)?.running;
  if (!Array.isArray(list)) throw new Error('brain sent bad running steps');
  return list as RunningStep[];
}

export function registerJobsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.listJobs, async () => parseRows(await callJson(brain, 'list_jobs')));
  handle(IPC.stopJob, async (_event, job: unknown) => {
    // The brain would refuse an unknown id too; a page that sends a non-string is not ours.
    if (typeof job !== 'string' || job === '') throw new Error('bad job id');
    await brain.call('stop_job', { job });
  });
  handle(IPC.jobActivity, async (_event, job: unknown, afterRev: unknown) => {
    if (typeof job !== 'string' || job === '') throw new Error('bad job id');
    if (typeof afterRev !== 'number' || !Number.isInteger(afterRev) || afterRev < 0) {
      throw new Error('bad cursor');
    }
    return parsePage(await callJson(brain, 'job_activity', { job, after_rev: afterRev }));
  });
  handle(IPC.jobReport, async (_event, job: unknown, part: unknown) => {
    if (typeof job !== 'string' || job === '') throw new Error('bad job id');
    if (typeof part !== 'string' || part === '') throw new Error('bad part id');
    const text = ((await callJson(brain, 'job_report', { job, part })) as { text?: unknown } | null)
      ?.text;
    if (text !== null && typeof text !== 'string') throw new Error('brain sent bad report');
    return text;
  });
  handle(IPC.runningSteps, async () => parseRunning(await callJson(brain, 'job_activity')));
}
