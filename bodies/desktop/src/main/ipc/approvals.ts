/**
 * IPC for Home's Approvals page: the history of permission decisions and the preferences Scout
 * follows. All four go through the brain's tools (list_approvals, list_preferences,
 * remove_preference, edit_preference); the brain owns the data and refuses what it must not
 * do, so a refusal rejects and the page shows the truth again. Contains registerApprovalsIpc.
 */

import type { ApprovalCounts, ApprovalRow, PreferenceRow } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const FILTERS = ['all', 'scout', 'refused'];

// The brain's row is snake_case and carries fields Home never shows (input, job_id, preference_id).
function toApproval(raw: Record<string, unknown>): ApprovalRow {
  return {
    id: raw.id,
    source: raw.source,
    tool: raw.tool,
    summary: raw.summary,
    outcome: raw.outcome,
    decidedBy: raw.decided_by,
    preference: raw.preference ?? null,
    at: raw.at,
  } as ApprovalRow;
}

function toPreference(raw: Record<string, unknown>): PreferenceRow {
  return {
    id: raw.id,
    sentence: raw.sentence,
    builtin: raw.builtin,
    createdAt: raw.created_at,
    useCount: raw.use_count,
    lastUsed: raw.last_used ?? null,
  } as PreferenceRow;
}

function parseApprovals(value: unknown): {
  approvals: ApprovalRow[];
  counts: ApprovalCounts;
  next: number | null;
} {
  const page = value as { approvals?: unknown; counts?: ApprovalCounts; next?: number | null };
  if (!Array.isArray(page?.approvals) || typeof page.counts !== 'object' || page.counts === null) {
    throw new Error('brain sent bad approvals');
  }
  return {
    approvals: page.approvals.map((raw) => toApproval(raw as Record<string, unknown>)),
    counts: page.counts,
    next: page.next ?? null,
  };
}

function parsePreferences(value: unknown): PreferenceRow[] {
  const list = (value as { preferences?: unknown } | null)?.preferences;
  if (!Array.isArray(list)) throw new Error('brain sent bad preferences');
  return list.map((raw) => toPreference(raw as Record<string, unknown>));
}

// The brain would refuse an unknown id too; a page that sends a non-integer is not ours.
function checkId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('bad preference id');
  return id as number;
}

export function registerApprovalsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.listApprovals, async (_event, filter: unknown, before: unknown) => {
    if (typeof filter !== 'string' || !FILTERS.includes(filter)) throw new Error('bad filter');
    const input = typeof before === 'number' ? { filter, before } : { filter };
    return parseApprovals(await callJson(brain, 'list_approvals', input));
  });
  handle(IPC.listPreferences, async () =>
    parsePreferences(await callJson(brain, 'list_preferences')),
  );
  handle(IPC.removePreference, async (_event, id: unknown) => {
    await brain.call('remove_preference', { id: checkId(id) });
  });
  handle(IPC.editPreference, async (_event, id: unknown, sentence: unknown) => {
    const checked = checkId(id);
    if (typeof sentence !== 'string') throw new Error('bad sentence');
    await brain.call('edit_preference', { id: checked, sentence });
  });
}
