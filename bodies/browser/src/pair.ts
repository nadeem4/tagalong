/**
 * Pairing the add-on with a short code from `tagalong pair --kind browser`. The code is
 * redeemed over loopback only, so any address but 127.0.0.1 is refused before a socket opens.
 */
import { PairResult, type BrainSocket } from '@tagalong/contract';

export interface PairDeps {
  openSocket: (url: string) => BrainSocket;
  addr: string;
  name: string;
  timeoutMs?: number;
}

export type PairOutcome = { ok: true; token: string } | { ok: false };

const CODE = /^\d{6}$/;
const LOOPBACK = /^127\.0\.0\.1:\d{1,5}$/;

export function pairBrowser(deps: PairDeps, code: string): Promise<PairOutcome> {
  const secret = code.trim();
  if (!CODE.test(secret) || !LOOPBACK.test(deps.addr)) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    const socket = deps.openSocket(`ws://${deps.addr}`);
    let done = false;
    const finish = (outcome: PairOutcome): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(outcome);
      socket.close();
    };
    const timer = setTimeout(() => finish({ ok: false }), deps.timeoutMs ?? 5000);
    socket.onClose(() => finish({ ok: false }));
    socket.onOpen(() =>
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'pair',
          params: { code: secret, device: { name: deps.name, kind: 'browser' } },
        }),
      ),
    );
    socket.onMessage((data) => {
      const reply = JSON.parse(data) as { result?: unknown };
      const result = PairResult.safeParse(reply.result);
      finish(result.success ? { ok: true, token: result.data.token } : { ok: false });
    });
  });
}
