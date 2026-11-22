/**
 * Pairing the add-on with a short code from `tagalong pair --kind browser`. The code is
 * redeemed over loopback only, so any address but 127.0.0.1 is refused before a socket opens.
 */
import { pairOverSocket, type BrainSocket } from '@tagalong/contract';

export interface PairDeps {
  openSocket: (url: string) => BrainSocket;
  addr: string;
  name: string;
  timeoutMs?: number;
}

export type PairOutcome = { ok: true; token: string } | { ok: false };

const CODE = /^\d{6}$/;
const LOOPBACK = /^127\.0\.0\.1:\d{1,5}$/;

export async function pairBrowser(deps: PairDeps, code: string): Promise<PairOutcome> {
  const secret = code.trim();
  if (!CODE.test(secret) || !LOOPBACK.test(deps.addr)) return { ok: false };
  const reply = await pairOverSocket(
    deps.openSocket(`ws://${deps.addr}`),
    secret,
    { name: deps.name, kind: 'browser' },
    deps.timeoutMs ?? 5000,
  );
  return reply.ok ? { ok: true, token: reply.token } : { ok: false };
}
