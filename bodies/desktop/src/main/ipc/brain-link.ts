/**
 * IPC for Home's "Where things run" card: the address the desktop dials and whether the link
 * is up. Read from the client itself, so no brain call is needed (and it works offline).
 * Contains registerBrainLinkIpc.
 */

import { IPC } from '../../shared/ipc';
import type { BrainStatus } from '@tagalong/contract';
import type { IpcHandle } from './handle';

export function registerBrainLinkIpc(
  handle: IpcHandle,
  deps: { brain: { addr: string; link: BrainStatus } },
): void {
  const { brain } = deps;
  handle(IPC.brainLink, () => ({ addr: `ws://${brain.addr}`, status: brain.link }));
}
