/** Tests for LinkStore: what is saved about a paired brain, and that its token never lands in the clear. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dialOrder } from '@tagalong/contract';
import { SETTINGS_FILENAME, SettingsStore } from '../settings-store';
import { LinkStore } from './link-store';
import type { SecretBox } from './link-store';

const reversed: SecretBox = {
  encrypt: (text) => Buffer.from([...text].reverse().join('')),
  decrypt: (data) => [...data.toString()].reverse().join(''),
};
const unavailable: SecretBox = {
  encrypt: () => {
    throw new Error('encryption is not available');
  },
  decrypt: () => {
    throw new Error('encryption is not available');
  },
};

const fp = 'cd'.repeat(32);
let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'tagalong-link-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LinkStore', () => {
  it('saves a remote link and round-trips the token without writing it to settings.json', () => {
    const store = new LinkStore(new SettingsStore(dir), reversed);
    store.saveRemote({ addrs: ['10.0.0.5:47323'], fp }, 'secret-device-token');

    const again = new LinkStore(new SettingsStore(dir), reversed);
    expect(again.paired()).toMatchObject({ addrs: ['10.0.0.5:47323'], fp });
    expect(again.token()).toBe('secret-device-token');
    expect(readFileSync(join(dir, SETTINGS_FILENAME), 'utf8')).not.toContain('secret-device-token');
  });

  it('refuses to save when the OS cannot seal the token', () => {
    const store = new LinkStore(new SettingsStore(dir), unavailable);
    expect(() => store.saveRemote({ addrs: ['a:1'], fp }, 'tok')).toThrow(/not available/);
    expect(store.paired()).toBeNull();
  });

  it('markGood makes that address the first to dial', () => {
    const store = new LinkStore(new SettingsStore(dir), reversed);
    store.saveRemote({ addrs: ['a:1', 'b:2'], fp }, 'tok');
    store.markGood('b:2');
    expect(dialOrder(store.paired()!, [])).toEqual(['b:2', 'a:1']);
  });
});
