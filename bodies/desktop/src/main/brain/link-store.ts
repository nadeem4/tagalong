/**
 * The paired brain this desktop dials: its addresses and certificate fingerprint live in
 * settings.json, the device token only sealed by the OS (Electron safeStorage in the app).
 * Without sealing available a remote link is refused rather than kept in the clear.
 */
import type { BrainLink } from '@tagalong/contract';
import type { SettingsStore } from '../settings-store';

export interface SecretBox {
  available(): boolean;
  /** Throws when the OS cannot seal secrets. */
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export type PairedLink = BrainLink & { fp: string };

/** The address to dial: the one that worked last, else the first the pairing gave. */
export const pairedAddr = (link: PairedLink): string | undefined => link.lastGood ?? link.addrs[0];

export class LinkStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretBox,
  ) {}

  /** The brain this desktop is paired with, or null while it uses the one on this PC. */
  paired(): PairedLink | null {
    const { addrs, lastGood, fp } = this.settings.get().brain;
    if (addrs.length === 0 || fp === undefined) return null;
    return { addrs, fp, ...(lastGood === undefined ? {} : { lastGood }) };
  }

  canSeal(): boolean {
    return this.secrets.available();
  }

  saveRemote(link: { addrs: string[]; fp: string }, token: string): void {
    const sealed = this.secrets.encrypt(token).toString('base64');
    this.settings.setBrain({ ...link, token: sealed });
  }

  markGood(addr: string): void {
    if (this.paired() !== null)
      this.settings.setBrain({ ...this.settings.get().brain, lastGood: addr });
  }

  /** Addresses the brain lists in hello (its tailnet address), after the ones already saved. */
  addAddrs(addrs: string[]): void {
    const current = this.settings.get().brain;
    const merged = [...new Set([...current.addrs, ...addrs])];
    if (this.paired() === null || merged.length === current.addrs.length) return;
    this.settings.setBrain({ ...current, addrs: merged });
  }

  forget(): void {
    this.settings.setBrain({ addrs: [] });
  }

  token(): string | null {
    const { token } = this.settings.get().brain;
    if (token === undefined) return null;
    try {
      return this.secrets.decrypt(Buffer.from(token, 'base64'));
    } catch {
      return null;
    }
  }
}
