/**
 * Pure helpers for reaching a paired brain: reading the `tagalong://pair` link the owner
 * scans or pastes, and the order a body tries brain addresses in. No sockets here, so the
 * contract package stays free of Node and browser globals.
 */
import { z } from 'zod';

export interface PairLink {
  addr: string;
  fp: string;
  code: string;
}

export interface BrainLink {
  addrs: string[];
  lastGood?: string;
  fp?: string;
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

/** Last good address, then the saved ones, then brains found on the network, then tailnet ones. */
export function dialOrder(link: BrainLink, found: string[], tailnet: string[]): string[] {
  const all = [
    ...(link.lastGood === undefined ? [] : [link.lastGood]),
    ...link.addrs,
    ...found,
    ...tailnet,
  ];
  return [...new Set(all)];
}
