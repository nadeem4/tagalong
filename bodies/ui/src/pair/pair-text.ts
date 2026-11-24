/**
 * The words the pairing screens use for a brain and for each way pairing can fail. Contains
 * brainNameOf, linkHost and pairErrorLine.
 */

import type { PairOutcome } from '../walkthrough/walkthrough-host';

/** What a person calls the brain at an address: its host, without scheme or port. */
export function brainNameOf(addr: string): string {
  return /^(?:\w+:\/\/)?\[?([^\]/:]+)/.exec(addr)?.[1] ?? addr;
}

/** The host a pairing link points at, or null when it is not a link. */
export function linkHost(link: string): string | null {
  const addr = /[?&]addr=([^&]+)/.exec(link)?.[1];
  return addr === undefined ? null : brainNameOf(decodeURIComponent(addr));
}

export function pairErrorLine(
  reason: Extract<PairOutcome, { ok: false }>['reason'],
  name: string,
): string {
  switch (reason) {
    case 'refused':
      return `That code has expired or was already used. Codes last 10 minutes. Make a new one on ${name}.`;
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
