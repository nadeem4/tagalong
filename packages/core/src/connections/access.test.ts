import { describe, expect, it } from 'vitest';
import { accessOf, expandEnv } from './access';

describe('accessOf', () => {
  it('is read only when the server says the tool is read-only', () => {
    expect(accessOf({ readOnlyHint: true })).toBe('read');
  });

  it('is write when unknown, when it may change things, or when the hints disagree', () => {
    expect(accessOf(undefined)).toBe('write');
    expect(accessOf({})).toBe('write');
    expect(accessOf({ readOnlyHint: false })).toBe('write');
    expect(accessOf({ destructiveHint: true })).toBe('write');
    expect(accessOf({ readOnlyHint: true, destructiveHint: true })).toBe('write');
  });
});

describe('expandEnv', () => {
  it('fills ${VAR} and ${VAR:-default} from the environment', () => {
    const env = { HOME: '/home/me', EMPTY: '' };
    expect(expandEnv('${HOME}/x', env)).toBe('/home/me/x');
    expect(expandEnv('${NOPE:-fallback}', env)).toBe('fallback');
    expect(expandEnv('${EMPTY:-fallback}', env)).toBe('fallback');
    expect(expandEnv('${NOPE}', env)).toBe('');
    expect(expandEnv('plain', env)).toBe('plain');
  });
});
