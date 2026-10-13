import { describe, expect, it } from 'vitest';
import { checkClaudeSignIn, parseAuthStatus } from './claude-sign-in';

const SIGNED_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c' });
const SIGNED_OUT = JSON.stringify({ loggedIn: false });

describe('parseAuthStatus', () => {
  it('reads loggedIn from `claude auth status --json`', () => {
    expect(parseAuthStatus(SIGNED_IN)).toBe('signed-in');
    expect(parseAuthStatus(SIGNED_OUT)).toBe('signed-out');
  });

  it('treats anything else as unknown', () => {
    expect(parseAuthStatus('')).toBe('unknown');
    expect(parseAuthStatus('Not JSON')).toBe('unknown');
    expect(parseAuthStatus('{"loggedIn":"yes"}')).toBe('unknown');
    expect(parseAuthStatus('[]')).toBe('unknown');
  });
});

describe('checkClaudeSignIn', () => {
  it('asks claude, locally, whether it is signed in', async () => {
    const calls: string[][] = [];
    const state = await checkClaudeSignIn((args) => {
      calls.push(args);
      return Promise.resolve({ stdout: SIGNED_IN });
    });
    expect(state).toBe('signed-in');
    expect(calls).toEqual([['auth', 'status', '--json']]);
  });

  it('believes the JSON even when claude exits non-zero', async () => {
    const state = await checkClaudeSignIn(() =>
      Promise.resolve({ stdout: SIGNED_OUT, errorCode: 1 }),
    );
    expect(state).toBe('signed-out');
  });

  it('says not installed when there is no claude to run', async () => {
    const state = await checkClaudeSignIn(() =>
      Promise.resolve({ stdout: '', errorCode: 'ENOENT' }),
    );
    expect(state).toBe('not-installed');
  });

  it('says unknown when claude times out or fails some other way', async () => {
    expect(
      await checkClaudeSignIn(() => Promise.resolve({ stdout: '', errorCode: 'ETIMEDOUT' })),
    ).toBe('unknown');
    expect(await checkClaudeSignIn(() => Promise.reject(new Error('boom')))).toBe('unknown');
  });
});
