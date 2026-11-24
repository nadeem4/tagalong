/**
 * What pairing this PC with a brain on another computer passes between the desktop and the UI:
 * a brain found nearby, how a pairing ended, and a code this PC's brain made for another device.
 */

/** A brain announcing itself on the home network; never trusted until paired. */
export interface FoundBrain {
  name: string;
  addr: string;
}

export type PairOutcome =
  | { ok: true }
  | { ok: false; reason: 'bad_link' | 'cannot_seal' | 'wrong_brain' | 'refused' | 'unreachable' };

/** One pairing code the brain made: its link, when it stops working (ISO, UTC) and the link as a terminal QR. */
export interface PairOffer {
  link: string;
  expiresAt: string;
  qr: string;
}
