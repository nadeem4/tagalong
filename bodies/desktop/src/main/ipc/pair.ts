/**
 * Pairing this desktop with a brain on another machine from the link the owner made there:
 * open a socket pinned to the link's fingerprint, pair over it, and keep the address,
 * fingerprint and device token only when the brain accepts. Contains pairWithLink and
 * registerPairIpc.
 */
import { pairOverSocket, parsePairLink } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import type { FoundBrain, PairOutcome } from '../../shared/ipc';
import type { LinkStore } from '../brain/link-store';
import type { PinnedSocket } from '../brain/pinned-socket';
import type { IpcHandle } from './handle';

export interface PairDeps {
  link: Pick<LinkStore, 'saveRemote' | 'forget'>;
  openSocket: (url: string, fingerprint: string) => PinnedSocket;
  /** Never given the code or the token. */
  log: (line: string) => void;
  timeoutMs?: number;
}

export async function pairWithLink(
  deps: PairDeps,
  text: string,
  deviceName: string,
): Promise<PairOutcome> {
  const parsed = parsePairLink(text);
  if (parsed === null) return { ok: false, reason: 'bad_link' };
  const { addr, fp, code } = parsed;
  const socket = deps.openSocket(`wss://${addr}`, fp);
  const reply = await pairOverSocket(
    socket,
    code,
    { name: deviceName, kind: 'desktop' },
    deps.timeoutMs ?? 10_000,
  );
  if (reply.ok) {
    deps.link.saveRemote({ addrs: [addr], fp }, reply.token);
    deps.log(`paired with the brain at ${addr}`);
    return { ok: true };
  }
  const reason =
    reply.reason === 'refused' ? 'refused' : socket.mismatch() ? 'wrong_brain' : 'unreachable';
  deps.log(`could not pair with ${addr}: ${reason}`);
  return { ok: false, reason };
}

export function registerPairIpc(
  handle: IpcHandle,
  deps: PairDeps & {
    deviceName: string;
    discover: () => Promise<FoundBrain[]>;
    /** Dial again: the saved link changed. */
    reconnect: () => void;
  },
): void {
  handle(IPC.pairDiscover, () => deps.discover());
  handle(IPC.pairWithLink, async (_event, text: string) => {
    const outcome = await pairWithLink(deps, text, deps.deviceName);
    if (outcome.ok) deps.reconnect();
    return outcome;
  });
  handle(IPC.pairForget, () => {
    deps.link.forget();
    deps.reconnect();
  });
}
