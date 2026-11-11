/**
 * IPC for Home's Permissions list: read each tool's mode and set one. Both go through the
 * brain's tools (list_permissions, set_permission); the brain owns the modes and refuses a
 * change it must not make, so a refusal rejects here and the panel shows the truth again.
 * Contains registerPermissionsIpc.
 */

import type { PermissionGroup, PermissionRow } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

/** The brain's rows with the groups they sit in; one without the other is not a permissions list. */
function parseList(value: unknown): { groups: PermissionGroup[]; rows: PermissionRow[] } {
  const reply = value as { tools?: unknown; groups?: unknown } | null;
  if (!Array.isArray(reply?.tools) || !Array.isArray(reply.groups)) {
    throw new Error('brain sent bad permissions');
  }
  return { groups: reply.groups as PermissionGroup[], rows: reply.tools as PermissionRow[] };
}

export function registerPermissionsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.listPermissions, async () => parseList(await callJson(brain, 'list_permissions')));
  handle(IPC.setPermission, async (_event, tool: string, mode: string) => {
    // The brain would refuse it too; a page that sends anything else is not ours.
    if (mode !== 'off' && mode !== 'ask' && mode !== 'auto') throw new Error('bad mode');
    await brain.call('set_permission', { tool, mode });
  });
}
