import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_PORT } from '@tagalong/protocol';
import { clearPairing, parsePairingInput, readPairing, savePairing } from './pairing';
import type { StorageArea } from './pairing';

const TOKEN = 'a'.repeat(64);

function memoryArea(initial: Record<string, unknown> = {}): StorageArea & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key) => {
      delete data[key];
      return Promise.resolve();
    },
  };
}

describe('parsePairingInput', () => {
  it('accepts the 64-hex token the desktop app shows, trimming what a paste drags along', () => {
    expect(parsePairingInput(`  ${TOKEN}\n`, '')).toEqual({
      ok: true,
      pairing: { token: TOKEN, port: DEFAULT_ENGINE_PORT },
    });
  });

  it('refuses anything that is not the token, so a bad paste fails here and not on the socket', () => {
    const result = parsePairingInput('not-a-token', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/64/);
  });

  it('takes a custom port for an engine moved off the default', () => {
    expect(parsePairingInput(TOKEN, '47400')).toEqual({
      ok: true,
      pairing: { token: TOKEN, port: 47400 },
    });
  });

  it('refuses a port outside the valid range', () => {
    expect(parsePairingInput(TOKEN, '70000').ok).toBe(false);
    expect(parsePairingInput(TOKEN, 'abc').ok).toBe(false);
  });
});

describe('pairing storage', () => {
  it('round-trips the token and port through storage', async () => {
    const area = memoryArea();
    await savePairing(area, { token: TOKEN, port: 47400 });
    expect(await readPairing(area)).toEqual({ token: TOKEN, port: 47400 });
  });

  it('reads nothing before the user has paired', async () => {
    expect(await readPairing(memoryArea())).toBeNull();
  });

  it('treats a corrupted record as unpaired instead of dialling with garbage', async () => {
    expect(await readPairing(memoryArea({ pairing: { token: 42 } }))).toBeNull();
  });

  it('forgets the pairing on clear', async () => {
    const area = memoryArea();
    await savePairing(area, { token: TOKEN, port: DEFAULT_ENGINE_PORT });
    await clearPairing(area);
    expect(await readPairing(area)).toBeNull();
  });
});
