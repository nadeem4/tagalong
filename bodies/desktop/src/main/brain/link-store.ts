/**
 * The paired brain this desktop dials: its addresses and certificate fingerprint live in
 * settings.json, the device token only sealed by the OS (Electron safeStorage in the app).
 * Without sealing available a remote link is refused rather than kept in the clear.
 */
import type { BrainLink } from '@tagalong/contract';
import type { SettingsStore } from '../settings-store';

export interface SecretBox {
  /** Throws when the OS cannot seal secrets. */
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export class LinkStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretBox,
  ) {}

  get(): BrainLink & { mode: 'local' | 'remote' } {
    const { mode, addrs, lastGood, fp } = this.settings.get().brain;
    return {
      mode,
      addrs,
      ...(lastGood === undefined ? {} : { lastGood }),
      ...(fp === undefined ? {} : { fp }),
    };
  }

  saveRemote(link: { addrs: string[]; fp: string }, token: string): void {
    const sealed = this.secrets.encrypt(token).toString('base64');
    this.settings.setBrain({ mode: 'remote', ...link, token: sealed });
  }

  markGood(addr: string): void {
    const brain = this.settings.get().brain;
    if (brain.mode === 'remote') this.settings.setBrain({ ...brain, lastGood: addr });
  }

  forget(): void {
    this.settings.setBrain({ mode: 'local', addrs: [] });
  }

  token(): string | null {
    const { token } = this.settings.get().brain;
    return token === undefined ? null : this.secrets.decrypt(Buffer.from(token, 'base64'));
  }
}
