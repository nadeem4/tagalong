/**
 * Pure part of the toolbar popup: the one-line brain status and the list of what the person
 * has allowed Scout to do, as plain rows. No chrome.* here, so it is testable.
 */
import type { BrainStatus } from '@tagalong/contract';
import {
  FILE_ORIGIN,
  OPTIONAL_PERMISSIONS,
  type Need,
  type OptionalPermission,
} from '../permissions';

export type WorkerQuery = { type: 'status' };
export type GrantRow = { label: string; need: Need };

/** The Chrome pattern for "every site"; not a real origin, but the one row that stands for all. */
export const ALL_SITES = '<all_urls>';

const STATUS_LINES: Record<BrainStatus, string> = {
  connecting: "Connecting to Scout's brain...",
  online: "Connected to Scout's brain",
  offline: "Scout's brain is not reachable",
  outdated: 'Needs an update: this browser add-on is older than the brain',
};

export function statusLine(status: BrainStatus): string {
  return STATUS_LINES[status];
}

function siteRow(pattern: string): GrantRow | null {
  if (pattern === 'file:///*') {
    return { label: 'Local files', need: { kind: 'site', origin: FILE_ORIGIN } };
  }
  const match = /^(https?:\/\/[^/]+)\/\*$/.exec(pattern);
  if (!match?.[1]) return null;
  return { label: new URL(match[1]).host, need: { kind: 'site', origin: match[1] } };
}

/** Only what Scout can ask for: manifest-required permissions like `storage` are not the person's to remove. */
export function grantRows(all: { permissions: string[]; origins: string[] }): GrantRow[] {
  const rows: GrantRow[] = all.permissions
    .filter((p): p is OptionalPermission => OPTIONAL_PERMISSIONS.includes(p as OptionalPermission))
    .map((name) => ({ label: name, need: { kind: 'permission', name } }));
  if (all.origins.includes(ALL_SITES)) {
    return [...rows, { label: 'All sites', need: { kind: 'site', origin: ALL_SITES } }];
  }
  for (const pattern of all.origins) {
    const row = siteRow(pattern);
    if (row) rows.push(row);
  }
  return rows;
}
