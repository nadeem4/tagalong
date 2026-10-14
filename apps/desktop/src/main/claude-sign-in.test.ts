import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('checkClaudeSignIn with the real runner', () => {
  let dir: string;
  let path: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagalong-sign-in-'));
    path = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });

  it('says not installed when no claude is on the PATH', async () => {
    process.env.PATH = dir;

    expect(await checkClaudeSignIn()).toBe('not-installed');
  });

  it.runIf(process.platform === 'win32')(
    'finds an npm install of claude, which is a .cmd shim on Windows',
    async () => {
      writeFileSync(join(dir, 'status.js'), `console.log(${JSON.stringify(SIGNED_OUT)});`);
      writeFileSync(join(dir, 'claude.cmd'), '@node "%~dp0status.js" %*\r\n');
      // Only the shim and node: a real claude elsewhere on the PATH must not answer instead.
      process.env.PATH = `${dir};${dirname(process.execPath)}`;

      expect(await checkClaudeSignIn()).toBe('signed-out');
    },
  );
});
