/**
 * Pairing this desktop with a brain on another machine from the link the owner made there:
 * open a socket pinned to the link's fingerprint, send `pair` as the very first message, and
 * keep the address, fingerprint and device token only when the brain accepts. Contains
 * pairWithLink and registerPairIpc.
 */
import { PairResult, parsePairLink } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import type { FoundBrain, PairOutcome } from '../../shared/ipc';
import type { LinkStore } from '../brain/link-store';
import type { PinnedSocket } from '../brain/pinned-socket';
import type { IpcHandle } from './handle';

export interface PairDeps {
  link: Pick<LinkStore, 'saveRemote'>;
  openSocket: (url: string, fingerprint: string) => PinnedSocket;
  /** Never given the code or the token. */
  log: (line: string) => void;
  timeoutMs?: number;
}

export function pairWithLink(
  deps: PairDeps,
  text: string,
  deviceName: string,
): Promise<PairOutcome> {
  const parsed = parsePairLink(text);
  if (parsed === null) return Promise.resolve({ ok: false, reason: 'bad_link' });
  const { addr, fp, code } = parsed;
  return new Promise((resolve) => {
    const socket = deps.openSocket(`wss://${addr}`, fp);
    const timer = setTimeout(
      () => done({ ok: false, reason: 'unreachable' }),
      deps.timeoutMs ?? 10_000,
    );
    let finished = false;
    function done(outcome: PairOutcome): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (!outcome.ok) deps.log(`could not pair with ${addr}: ${outcome.reason}`);
      resolve(outcome);
    }
    socket.onOpen(() =>
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'pair-1',
          method: 'pair',
          params: { code, device: { name: deviceName, kind: 'desktop' } },
        }),
      ),
    );
    socket.onMessage((data) => {
      let msg: { error?: unknown; result?: unknown };
      try {
        msg = JSON.parse(data) as typeof msg;
      } catch {
        return;
      }
      const result = PairResult.safeParse(msg.result);
      if (msg.error !== undefined || !result.success) return done({ ok: false, reason: 'refused' });
      deps.link.saveRemote({ addrs: [addr], fp }, result.data.token);
      deps.log(`paired with the brain at ${addr}`);
      done({ ok: true });
    });
    socket.onClose(() =>
      done({ ok: false, reason: socket.mismatch() ? 'wrong_brain' : 'unreachable' }),
    );
  });
}

export function registerPairIpc(
  handle: IpcHandle,
  deps: PairDeps & {
    deviceName: () => string;
    forget: () => void;
    discover: () => Promise<FoundBrain[]>;
    /** Dial again: the saved link changed. */
    reconnect: () => void;
  },
): void {
  handle(IPC.pairDiscover, () => deps.discover());
  handle(IPC.pairWithLink, async (_event, text: string) => {
    const outcome = await pairWithLink(deps, text, deps.deviceName());
    if (outcome.ok) deps.reconnect();
    return outcome;
  });
  handle(IPC.pairForget, () => {
    deps.forget();
    deps.reconnect();
  });
}
