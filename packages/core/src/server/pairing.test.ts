/** Tests for the pairing token: created once, reused, compared safely. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAIRING_FILENAME, readOrCreatePairingToken, tokensMatch } from './pairing';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-pairing-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readOrCreatePairingToken', () => {
  it('writes a token on first boot', () => {
    const token = readOrCreatePairingToken(dir);

    expect(token).toHaveLength(64);
    expect(readFileSync(join(dir, PAIRING_FILENAME), 'utf8').trim()).toBe(token);
  });

  it('reuses the token on later boots so paired hosts keep working', () => {
    const first = readOrCreatePairingToken(dir);
    const second = readOrCreatePairingToken(dir);

    expect(second).toBe(first);
  });

  it('replaces an empty or whitespace-only token file', () => {
    writeFileSync(join(dir, PAIRING_FILENAME), '   \n');

    const token = readOrCreatePairingToken(dir);

    expect(token).toHaveLength(64);
  });

  it('produces a different token per data dir', () => {
    const other = mkdtempSync(join(tmpdir(), 'tagalong-pairing-'));
    try {
      expect(readOrCreatePairingToken(dir)).not.toBe(readOrCreatePairingToken(other));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('tokensMatch', () => {
  it('accepts the right token', () => {
    expect(tokensMatch('a'.repeat(64), 'a'.repeat(64))).toBe(true);
  });

  it('rejects the wrong token', () => {
    expect(tokensMatch('a'.repeat(64), 'b'.repeat(64))).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    expect(tokensMatch('a'.repeat(64), 'short')).toBe(false);
    expect(tokensMatch('a'.repeat(64), '')).toBe(false);
  });
});
