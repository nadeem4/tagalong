/**
 * Pure helpers for reaching a paired brain: reading the `tagalong://pair` link the owner
 * scans or pastes, and the order a body tries brain addresses in. No sockets here, so the
 * contract package stays free of Node and browser globals.
 */
import { z } from 'zod';
import type { BrainSocket } from './brain-client.js';
import { PairResult } from './messages.js';

export interface PairLink {
  addr: string;
  fp: string;
  code: string;
}

export interface BrainLink {
  addrs: string[];
  lastGood?: string;
}

const Addr = z.string().regex(/^[A-Za-z0-9.-]+:\d{1,5}$|^\[[0-9A-Fa-f:]+\]:\d{1,5}$/);
const Fingerprint = z.string().regex(/^[0-9a-fA-F]{64}$/);

export function parsePairLink(text: string): PairLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'tagalong:' || url.hostname !== 'pair') return null;
  const parsed = z
    .object({ addr: Addr, fp: Fingerprint, code: z.string().min(1) })
    .safeParse(Object.fromEntries(url.searchParams));
  return parsed.success ? parsed.data : null;
}

/** Last good address, then the saved ones, then brains found on the network. */
export function dialOrder(link: BrainLink, found: string[]): string[] {
  const all = [...(link.lastGood === undefined ? [] : [link.lastGood]), ...link.addrs, ...found];
  return [...new Set(all)];
}

export type PairReply =
  { ok: true; token: string } | { ok: false; reason: 'refused' | 'closed' | 'timeout' };

/**
 * Sends `pair` as the first message on an open socket and waits for the brain's answer.
 * The socket is closed on every outcome; the caller decides what each refusal means.
 */
export function pairOverSocket(
  socket: BrainSocket,
  code: string,
  device: { name: string; kind: 'desktop' | 'browser' },
  timeoutMs: number,
): Promise<PairReply> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: PairReply): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    socket.onOpen(() =>
      socket.send(
        JSON.stringify({ jsonrpc: '2.0', id: 'pair-1', method: 'pair', params: { code, device } }),
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
      finish(
        msg.error === undefined && result.success
          ? { ok: true, token: result.data.token }
          : { ok: false, reason: 'refused' },
      );
    });
    socket.onClose(() => finish({ ok: false, reason: 'closed' }));
  });
}
