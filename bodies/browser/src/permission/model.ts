/**
 * Pure part of the permission window: the query string a request travels in, the buttons it
 * shows, and the Chrome permission request each button makes. No chrome.* here, so it is testable.
 */
import {
  FILE_ORIGIN,
  OPTIONAL_PERMISSIONS,
  originPattern,
  type Need,
  type OptionalPermission,
} from '../permissions';

type PermissionRequest = { id: string; need: Need; reason: string };
export type Scope = 'site' | 'all' | 'once' | 'no';

function validOrigin(origin: string): boolean {
  if (origin === FILE_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin;
  } catch {
    return false;
  }
}

export function requestQuery(req: PermissionRequest): string {
  const q = new URLSearchParams({ id: req.id, kind: req.need.kind, reason: req.reason });
  if (req.need.kind === 'permission') q.set('name', req.need.name);
  else q.set('origin', req.need.origin);
  return q.toString();
}

export function parseRequest(search: string): PermissionRequest | null {
  const q = new URLSearchParams(search);
  const id = q.get('id');
  const reason = q.get('reason');
  if (!id || reason === null) return null;
  const kind = q.get('kind');
  if (kind === 'permission') {
    const name = q.get('name');
    if (!OPTIONAL_PERMISSIONS.includes(name as OptionalPermission)) return null;
    return { id, reason, need: { kind, name: name as OptionalPermission } };
  }
  if (kind === 'site') {
    const origin = q.get('origin');
    if (origin === null || !validOrigin(origin)) return null;
    return { id, reason, need: { kind, origin } };
  }
  return null;
}

export function buttonsFor(need: Need): { label: string; scope: Scope }[] {
  if (need.kind === 'site') {
    return [
      { label: 'Allow on this site', scope: 'site' },
      { label: 'Allow on all sites', scope: 'all' },
      { label: 'Not now', scope: 'no' },
    ];
  }
  return [
    { label: 'Allow', scope: 'once' },
    { label: 'Not now', scope: 'no' },
  ];
}

export function chromeRequestFor(
  need: Need,
  scope: Scope,
): { permissions?: string[]; origins?: string[] } | null {
  if (need.kind === 'site') {
    if (scope === 'site') return { origins: [originPattern(need.origin)] };
    if (scope === 'all') return { origins: ['<all_urls>'] };
    return null;
  }
  return scope === 'once' ? { permissions: [need.name] } : null;
}
