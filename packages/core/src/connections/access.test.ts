/** Tests for access.ts: read or write classification and ${VAR} expansion. */
import { describe, expect, it } from 'vitest';
import { accessOf, expandEnv, riskOf } from './access';

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

describe('riskOf', () => {
  it('is read for a read-only tool: no ask', () => {
    expect(riskOf({ readOnlyHint: true }, 'delete_page')).toBe('read');
  });

  it('is high when the app says destructive, or the name says it cannot be taken back', () => {
    expect(riskOf({ destructiveHint: true }, 'create_page')).toBe('high');
    expect(riskOf(undefined, 'send_email')).toBe('high');
    expect(riskOf(undefined, 'deletePage')).toBe('high');
    expect(riskOf(undefined, 'git-push')).toBe('high');
    expect(riskOf(undefined, 'merge_pull_request')).toBe('high');
    expect(riskOf({}, 'postMessage')).toBe('high');
  });

  it('is change for every other write, unknown tools included', () => {
    expect(riskOf(undefined, 'create_page')).toBe('change');
    expect(riskOf({}, 'update_issue')).toBe('change');
    // A word inside another word is not that word.
    expect(riskOf({}, 'resend_later_draft')).toBe('change');
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
