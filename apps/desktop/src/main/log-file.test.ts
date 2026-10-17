/** Tests for the log file: what a line keeps, hiding secrets, the cut, rotation, failed writes. */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLogFile, logLine, openLogsFolder, rendererConsole } from './log-file';
import { forwardConsole } from './log-text';

const NOW = new Date('2026-10-16T21:40:00.000Z');

describe('logLine', () => {
  it('stamps the time and level and keeps a text first argument', () => {
    expect(logLine('warn', ['could not save Always listening'], NOW)).toBe(
      '2026-10-16T21:40:00.000Z WARN could not save Always listening',
    );
  });

  it("keeps an Error's name and message, never its stack", () => {
    const line = logLine('error', ['could not save:', new Error('EPERM')], NOW);
    expect(line).toBe('2026-10-16T21:40:00.000Z ERROR could not save: Error: EPERM');
    expect(line).not.toContain('at ');
  });

  it('turns objects and other values into their type, so no payload rides in', () => {
    const line = logLine('warn', ['turn failed', { text: 'my secret plans' }, 42, ['a']], NOW);
    expect(line).toBe('2026-10-16T21:40:00.000Z WARN turn failed [object] [number] [object]');
    expect(line).not.toContain('secret plans');
  });

  it('turns a text second argument into its type too (only the first is kept as text)', () => {
    const line = logLine('warn', ['heard', 'what the person said'], NOW);
    expect(line).not.toContain('what the person said');
    expect(line).toContain('[string]');
  });

  it('logs an Error given first', () => {
    expect(logLine('error', [new TypeError('bad')], NOW)).toBe(
      '2026-10-16T21:40:00.000Z ERROR TypeError: bad',
    );
  });

  it('hides a key-shaped string', () => {
    const line = logLine('warn', [`bad key sk-ant-${'a'.repeat(30)}`], NOW);
    expect(line).not.toContain('aaaaaaaaaa');
    expect(line).toContain('[hidden: API key]');
  });

  it('hides a key inside an error message', () => {
    const line = logLine('error', ['call failed', new Error(`token ghp_${'b'.repeat(36)}`)], NOW);
    expect(line).not.toContain('bbbbbbbbbb');
  });

  it('cuts a line at 300 characters and keeps it on one line', () => {
    const line = logLine('warn', [`first\nsecond ${'x'.repeat(500)}`], NOW);
    expect(line).toHaveLength(300);
    expect(line).not.toContain('\n');
  });
});

describe('installLogFile', () => {
  let dir: string;
  type Log = (...args: unknown[]) => void;
  let fakeConsole: { warn: Log; error: Log };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagalong-log-'));
    fakeConsole = { warn: vi.fn<Log>(), error: vi.fn<Log>() };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = () => join(dir, 'logs', 'tagalong.log');

  it('writes warnings and errors to tagalong.log, and the originals still run', () => {
    const original = { warn: vi.fn<Log>(), error: vi.fn<Log>() };
    fakeConsole = { ...original };
    installLogFile({ dir: join(dir, 'logs'), console: fakeConsole, now: () => NOW });
    fakeConsole.warn('first', new Error('one'));
    fakeConsole.error('second');
    expect(readFileSync(file(), 'utf8')).toBe(
      '2026-10-16T21:40:00.000Z WARN first Error: one\n' +
        '2026-10-16T21:40:00.000Z ERROR second\n',
    );
    expect(original.warn).toHaveBeenCalledOnce();
    expect(original.error).toHaveBeenCalledOnce();
  });

  it('passes every argument on to the original console', () => {
    const warn = vi.fn<Log>();
    const target = { warn, error: vi.fn<Log>() };
    installLogFile({ dir: join(dir, 'logs'), console: target, now: () => NOW });
    const payload = { a: 1 };
    target.warn('x', payload);
    expect(warn).toHaveBeenCalledWith('x', payload);
  });

  it('rotates once past 1 MB into tagalong.1.log, replacing the old one', () => {
    installLogFile({ dir: join(dir, 'logs'), console: fakeConsole, now: () => NOW });
    fakeConsole.warn('start');
    writeFileSync(join(dir, 'logs', 'tagalong.1.log'), 'old');
    writeFileSync(file(), 'y'.repeat(1024 * 1024 + 1));
    fakeConsole.warn('after');
    expect(readFileSync(file(), 'utf8')).toBe('2026-10-16T21:40:00.000Z WARN after\n');
    expect(statSync(join(dir, 'logs', 'tagalong.1.log')).size).toBe(1024 * 1024 + 1);
  });

  it('never throws when the disk write fails', () => {
    const blocker = join(dir, 'not-a-folder');
    writeFileSync(blocker, '');
    installLogFile({ dir: join(blocker, 'logs'), console: fakeConsole, now: () => NOW });
    expect(() => fakeConsole.error('still fine')).not.toThrow();
    expect(existsSync(join(blocker, 'logs'))).toBe(false);
  });

  it('never throws when a line cannot be built', () => {
    installLogFile({ dir: join(dir, 'logs'), console: fakeConsole, now: () => NOW });
    const odd = new Error();
    Object.defineProperty(odd, 'message', {
      get() {
        throw new Error('no message');
      },
    });
    expect(() => fakeConsole.warn('odd', odd)).not.toThrow();
  });
});

describe('forwardConsole', () => {
  // The voice process has no log file of its own: its warnings travel to main's.
  it('passes on the kept text of each warning and error, and the originals still run', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const target = { warn, error };
    const post = vi.fn();
    forwardConsole(post, target);
    target.warn('[ears] the models could not load', new Error('no file'), 'heard words');
    target.error('[voice] boom', { text: 'my secret plans' });
    expect(post.mock.calls).toEqual([
      ['warn', '[ears] the models could not load Error: no file [string]'],
      ['error', '[voice] boom [object]'],
    ]);
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('never throws when posting fails', () => {
    const target = { warn: vi.fn(), error: vi.fn() };
    forwardConsole(() => {
      throw new Error('port closed');
    }, target);
    expect(() => target.warn('x')).not.toThrow();
  });
});

describe('rendererConsole', () => {
  it('logs a window’s warnings and errors, marked as the renderer’s', () => {
    const target = { warn: vi.fn(), error: vi.fn() };
    rendererConsole({ level: 'warning', message: '[talk] could not show a status mark' }, target);
    rendererConsole({ level: 'error', message: 'Uncaught TypeError: x' }, target);
    expect(target.warn).toHaveBeenCalledWith('[renderer] [talk] could not show a status mark');
    expect(target.error).toHaveBeenCalledWith('[renderer] Uncaught TypeError: x');
  });

  it('leaves out info and debug messages', () => {
    const target = { warn: vi.fn(), error: vi.fn() };
    rendererConsole({ level: 'info', message: 'hello' }, target);
    rendererConsole({ level: 'debug', message: 'hello' }, target);
    expect(target.warn).not.toHaveBeenCalled();
    expect(target.error).not.toHaveBeenCalled();
  });
});

describe('openLogsFolder', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagalong-log-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('makes the folder first, so it opens before anything was logged', async () => {
    const logs = join(dir, 'logs');
    const open = vi.fn(async (path: string) => {
      expect(existsSync(path)).toBe(true);
      return '';
    });
    await openLogsFolder(logs, open);
    expect(open).toHaveBeenCalledWith(logs);
  });
});
