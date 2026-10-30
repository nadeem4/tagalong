/**
 * Pins the brain address and optional name the popup saves.
 * Bad input must never land in storage, and bad stored values must fall back to the
 * defaults instead of breaking the connection.
 */
import { describe, expect, it } from 'vitest';
import type { StorageArea } from './layer/api';
import { DEFAULT_ADDR, parseAddr, readSettings, saveAddr, saveName } from './settings';

function memory(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

describe('settings', () => {
  it('defaults_when_nothing_is_stored', async () => {
    expect(await readSettings(memory())).toEqual({ addr: DEFAULT_ADDR, name: null });
    expect(DEFAULT_ADDR).toBe('127.0.0.1:47321');
  });

  it('falls_back_when_stored_values_are_bad', async () => {
    const storage = memory();
    await storage.set('brainAddr', 'ws://nope');
    await storage.set('bodyName', 42);
    expect(await readSettings(storage)).toEqual({ addr: DEFAULT_ADDR, name: null });
  });

  it.each([
    ['127.0.0.1:47321', '127.0.0.1:47321'],
    ['host.local:1', 'host.local:1'],
    ['  host.local:65535 ', 'host.local:65535'],
    [':80', null],
    ['host', null],
    ['host:0', null],
    ['host:65536', null],
    ['ws://h:1', null],
  ])('parseAddr(%j)', (input, expected) => {
    expect(parseAddr(input)).toBe(expected);
  });

  it('saveAddr_refuses_a_bad_address_and_keeps_the_old_one', async () => {
    const storage = memory();
    expect(await saveAddr(storage, 'a.b:1234')).toBe(true);
    expect(await saveAddr(storage, 'ws://bad')).toBe(false);
    expect((await readSettings(storage)).addr).toBe('a.b:1234');
  });

  it('saveName_trims_caps_and_clears', async () => {
    const storage = memory();
    await saveName(storage, '  Work laptop  ');
    expect((await readSettings(storage)).name).toBe('Work laptop');
    await saveName(storage, 'x'.repeat(50));
    expect((await readSettings(storage)).name).toBe('x'.repeat(32));
    await saveName(storage, '   ');
    expect((await readSettings(storage)).name).toBeNull();
  });
});
