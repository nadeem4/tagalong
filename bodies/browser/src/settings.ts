/**
 * The two things the popup lets the person change: where the brain is, and an
 * optional display name. Bad stored values fall back rather than break the connection.
 * No chrome.* here; storage is passed in.
 */
import type { StorageArea } from './layer/api';

export const DEFAULT_ADDR = '127.0.0.1:47321';

export const ADDR_KEY = 'brainAddr';
export const NAME_KEY = 'bodyName';
const MAX_NAME = 32;
const ADDR_PATTERN = /^([A-Za-z0-9.-]+):(\d{1,5})$/;

/** `host:port` only; a bare host or a scheme prefix is rejected so the stored form is uniform. */
export function parseAddr(input: string): string | null {
  const trimmed = input.trim();
  const match = ADDR_PATTERN.exec(trimmed);
  if (!match) return null;
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535 ? trimmed : null;
}

export async function readSettings(
  storage: StorageArea,
): Promise<{ addr: string; name: string | null }> {
  const addr = await storage.get(ADDR_KEY);
  const name = await storage.get(NAME_KEY);
  return {
    addr: typeof addr === 'string' && parseAddr(addr) !== null ? addr : DEFAULT_ADDR,
    name: typeof name === 'string' && name !== '' ? name : null,
  };
}

export async function saveAddr(storage: StorageArea, addr: string): Promise<boolean> {
  const parsed = parseAddr(addr);
  if (parsed === null) return false;
  await storage.set(ADDR_KEY, parsed);
  return true;
}

export async function saveName(storage: StorageArea, name: string): Promise<void> {
  await storage.set(NAME_KEY, name.trim().slice(0, MAX_NAME).trim());
}
