import { DEFAULT_ENGINE_PORT } from '@tagalong/protocol';

/**
 * Where the pairing lives: `chrome.storage.local`, behind the slice of its API used here.
 *
 * Local rather than sync: the token opens the user's engine on this machine, and a copy
 * synced to every other Chrome they sign into would be a secret travelling for no reason.
 */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Pairing {
  token: string;
  port: number;
}

export const PAIRING_KEY = 'pairing';

/** The engine mints 32 random bytes as hex; anything else is a paste gone wrong. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export type PairingInput = { ok: true; pairing: Pairing } | { ok: false; error: string };

/** Validates what the user typed into the options page. An empty port means the default. */
export function parsePairingInput(token: string, port: string): PairingInput {
  const trimmed = token.trim();
  if (!TOKEN_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: 'That is not a pairing token. Copy the 64-character token from Tagalong Settings.',
    };
  }
  const portText = port.trim();
  if (portText === '') return { ok: true, pairing: { token: trimmed, port: DEFAULT_ENGINE_PORT } };
  const parsed = Number(portText);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return { ok: false, error: 'The port must be a whole number between 1 and 65535.' };
  }
  return { ok: true, pairing: { token: trimmed, port: parsed } };
}

export async function readPairing(area: StorageArea): Promise<Pairing | null> {
  const stored = (await area.get(PAIRING_KEY))[PAIRING_KEY];
  if (typeof stored !== 'object' || stored === null) return null;
  const { token, port } = stored as Record<string, unknown>;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return { token, port: typeof port === 'number' ? port : DEFAULT_ENGINE_PORT };
}

export async function savePairing(area: StorageArea, pairing: Pairing): Promise<void> {
  await area.set({ [PAIRING_KEY]: pairing });
}

export async function clearPairing(area: StorageArea): Promise<void> {
  await area.remove(PAIRING_KEY);
}
