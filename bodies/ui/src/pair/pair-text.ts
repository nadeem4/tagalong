/**
 * The words the pairing screens use for a brain and for each way pairing can fail. Contains
 * brainNameOf, isLocalAddr, linkHost and pairErrorLine.
 */

import { parsePairLink } from '@tagalong/contract';
import type { PairOutcome } from '../shapes/pairing';

/** What a person calls the brain at an address: its host, without scheme or port. */
export function brainNameOf(addr: string): string {
  return /^(?:\w+:\/\/)?\[?([^\]/:]+)/.exec(addr)?.[1] ?? addr;
}

/** Whether an address is this computer's own brain rather than another machine's. */
export function isLocalAddr(addr: string): boolean {
  return /^(?:\w+:\/\/)?(127\.0\.0\.1|localhost|\[?::1\]?)(:|$)/.test(addr);
}

/** The host a pairing link points at, or null when it is not a link. */
export function linkHost(link: string): string | null {
  const parsed = parsePairLink(link);
  return parsed === null ? null : brainNameOf(parsed.addr);
}

export function pairErrorLine(
  reason: Extract<PairOutcome, { ok: false }>['reason'],
  name: string,
): string {
  switch (reason) {
    case 'refused':
      return `That code has expired, was already used, or there were too many wrong tries. Wait a minute, then make a new one on ${name}.`;
    case 'wrong_brain':
      return 'This is not the computer that made this link. Nothing was sent.';
    case 'unreachable':
      return `Can’t reach ${name}. Check it is switched on and on the same network. Away from home? It needs Tailscale.`;
    case 'bad_link':
      return 'That isn’t a Scout pairing link. It starts with tagalong://pair.';
    case 'cannot_seal':
      return 'This PC could not secure the pairing. Try again.';
  }
}
