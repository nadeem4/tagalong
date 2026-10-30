/**
 * Who this browser install is to the brain: a kind plus a random per-install id.
 * The id is made once and kept, so two browsers or profiles never share a body id
 * and a restart reconnects as the same body. No chrome.* here; storage is passed in.
 */
import type { StorageArea } from './layer/api';

export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'arc' | 'chromium';

const NAMES: Record<BrowserKind, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  arc: 'Arc',
  chromium: 'Chromium',
};

const BODY_ID_KEY = 'bodyId';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Brands first (most reliable); the user agent only when the browser gives none. */
export function detectBrowser(brands: readonly string[], userAgent: string): BrowserKind {
  const has = (word: string) => brands.some((b) => b.includes(word));
  if (has('Edge')) return 'edge';
  if (has('Brave')) return 'brave';
  if (has('Opera')) return 'opera';
  if (has('Vivaldi')) return 'vivaldi';
  if (has('Arc')) return 'arc';
  if (has('Chrome')) return 'chrome';
  if (has('Chromium')) return 'chromium';
  if (brands.length > 0) return 'chromium';
  if (userAgent.includes('Edg/')) return 'edge';
  if (userAgent.includes('OPR/')) return 'opera';
  if (userAgent.includes('Vivaldi/')) return 'vivaldi';
  if (userAgent.includes('Chrome/')) return 'chrome';
  return 'chromium';
}

export function browserName(kind: BrowserKind): string {
  return NAMES[kind];
}

export function makeBodyId(kind: BrowserKind, random: () => string): string {
  return `${kind}-${random()}`;
}

function randomSuffix(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export async function loadBodyId(
  storage: StorageArea,
  kind: BrowserKind,
  random: () => string = randomSuffix,
): Promise<string> {
  const stored = await storage.get(BODY_ID_KEY);
  if (typeof stored === 'string' && /^[a-z0-9-]{1,32}$/.test(stored)) return stored;
  const id = makeBodyId(kind, random);
  await storage.set(BODY_ID_KEY, id);
  return id;
}
