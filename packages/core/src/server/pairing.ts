/**
 * The pairing token every host presents in hello. Contains `readOrCreatePairingToken`
 * (stable across boots, file mode 0600) and `tokensMatch` (constant-time). Loopback is
 * not a permission boundary; this token is.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where a host looks for the token. The desktop host reads it directly. */
export const PAIRING_FILENAME = 'pairing.token';

/**
 * The engine listens on loopback, but loopback is not a permission boundary: any
 * process on the machine can open a socket to it. The pairing token is what stops a
 * random local program from driving the user's pets.
 *
 * The token is stable across boots so a host that has already paired — the Chrome
 * extension, where the user pasted it by hand — does not have to pair again.
 */
export function readOrCreatePairingToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, PAIRING_FILENAME);

  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length > 0) return existing;
  }

  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

/**
 * Constant-time comparison. A plain `===` leaks the length of the shared prefix
 * through timing, which is enough to recover a token one character at a time.
 */
export function tokensMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the length is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
