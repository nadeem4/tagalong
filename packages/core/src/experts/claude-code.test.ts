import { describe, expect, it } from 'vitest';
import { ClaudeCodeConnector, type ChildRun, type SpawnFn } from './claude-code';

interface Spawned {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  killed: boolean;
}

/** A stand-in for the claude process: replays stream-json lines, then exits. */
function fakeSpawn(
  lines: unknown[],
  exitCode = 0,
  stderr = '',
): { spawn: SpawnFn; calls: Spawned[] } {
  const calls: Spawned[] = [];
  const spawn: SpawnFn = (command, args, { cwd }) => {
    const call: Spawned = { command, args, cwd, stdin: '', killed: false };
    calls.push(call);
    let release: () => void = () => {};
    const killed = new Promise<void>((resolve) => (release = resolve));
    const run: ChildRun = {
      write: (text) => {
        call.stdin += text;
      },
      lines: (async function* () {
        for (const line of lines) {
          if (call.killed) return;
          yield typeof line === 'string' ? line : JSON.stringify(line);
        }
        if (lines.length === 0) await killed;
      })(),
      exit: (async () => {
        await Promise.resolve();
        return call.killed ? null : exitCode;
      })(),
      stderr: () => stderr,
      kill: () => {
        call.killed = true;
        release();
      },
    };
    return run;
  };
  return { spawn, calls };
}

const assistant = (content: unknown[]) => ({ type: 'assistant', message: { content } });
const result = (text: string, isError = false) => ({
  type: 'result',
  subtype: isError ? 'error_during_execution' : 'success',
  is_error: isError,
  result: text,
});

describe('ClaudeCodeConnector', () => {
  it('runs claude headless in the expert folder, read-only by default, with the brief on stdin', async () => {
    const { spawn, calls } = fakeSpawn([result('Answer.')]);
    const connector = new ClaudeCodeConnector({ folder: 'C:\\work\\repo', spawn });
    await connector.send({ ask: 'Explain main.ts' }, () => {});

    const [call] = calls;
    expect(call?.command).toBe('claude');
    expect(call?.cwd).toBe('C:\\work\\repo');
    expect(call?.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'Read',
      'Glob',
      'Grep',
    ]);
    expect(call?.stdin).toBe('Explain main.ts');
  });

  it('lets edits through only when the expert may edit', async () => {
    const { spawn, calls } = fakeSpawn([result('ok')]);
    const connector = new ClaudeCodeConnector({ folder: 'C:\\r', canEdit: true, spawn });
    await connector.send({ ask: 'Fix it' }, () => {});
    const args = calls[0]?.args ?? [];
    expect(
      args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2),
    ).toEqual(['--permission-mode', 'acceptEdits']);
    expect(args).toContain('Edit');
    expect(args).toContain('Write');
  });

  it('uses the command it was given', async () => {
    const { spawn, calls } = fakeSpawn([result('ok')]);
    await new ClaudeCodeConnector({ folder: 'C:\\r', command: 'C:\\bin\\claude.exe', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(calls[0]?.command).toBe('C:\\bin\\claude.exe');
  });

  it('turns tool calls into progress steps and returns the final result', async () => {
    const { spawn } = fakeSpawn([
      { type: 'system', subtype: 'init' },
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: 'src/main.ts' } }]),
      assistant([{ type: 'tool_use', name: 'Grep', input: { pattern: 'boot' } }]),
      assistant([{ type: 'text', text: 'Looking good.' }]),
      result('main.ts boots the engine.'),
    ]);
    const progress: string[] = [];
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send({ ask: 'x' }, (s) =>
      progress.push(s),
    );
    expect(progress).toEqual(['Reading src/main.ts', 'Searching for boot']);
    expect(out).toEqual({ ok: true, text: 'main.ts boots the engine.', changedFiles: [] });
  });

  it('lists the files it changed, once each', async () => {
    const { spawn } = fakeSpawn([
      assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }]),
      assistant([{ type: 'tool_use', name: 'Write', input: { file_path: 'b.ts' } }]),
      assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }]),
      result('Fixed.'),
    ]);
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', canEdit: true, spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({ ok: true, text: 'Fixed.', changedFiles: ['a.ts', 'b.ts'] });
  });

  it('skips lines that are not JSON', async () => {
    const { spawn } = fakeSpawn(['not json', result('fine')]);
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({ ok: true, text: 'fine', changedFiles: [] });
  });

  it('reports an error result as a failure', async () => {
    const { spawn } = fakeSpawn([result('Ran out of turns.', true)]);
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({ ok: false, error: 'Ran out of turns.' });
  });

  it('reports a non-zero exit with no result, using what claude printed', async () => {
    const { spawn } = fakeSpawn(
      [{ type: 'system', subtype: 'init' }],
      1,
      'Invalid API key. Please run /login\n',
    );
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({
      ok: false,
      error: 'Claude Code stopped: Invalid API key. Please run /login',
    });
  });

  it('says so when claude cannot be started', async () => {
    const spawn: SpawnFn = () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    };
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({
      ok: false,
      error: 'Claude Code is not installed, or "claude" is not on the PATH.',
    });
  });

  it('kills the process when the hand-off is cancelled', async () => {
    const { spawn, calls } = fakeSpawn([]);
    const controller = new AbortController();
    const pending = new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
      controller.signal,
    );
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
    expect(calls[0]?.killed).toBe(true);
  });
});

describe('ClaudeCodeConnector.check', () => {
  it('asks claude for its version in the folder, which costs nothing', async () => {
    const { spawn, calls } = fakeSpawn(['2.1.0 (Claude Code)']);
    const connector = new ClaudeCodeConnector({ folder: 'C:\\r', spawn, folderExists: () => true });
    expect(await connector.check()).toEqual({ ok: true });
    expect(calls[0]?.args).toEqual(['--version']);
    expect(calls[0]?.cwd).toBe('C:\\r');
  });

  it('names a folder that is not there', async () => {
    const { spawn, calls } = fakeSpawn([]);
    const connector = new ClaudeCodeConnector({
      folder: 'C:\\gone',
      spawn,
      folderExists: () => false,
    });
    expect(await connector.check()).toEqual({
      ok: false,
      error: 'The folder C:\\gone does not exist.',
    });
    expect(calls).toHaveLength(0);
  });

  it('says when claude is missing or fails', async () => {
    const missing: SpawnFn = () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    };
    expect(
      await new ClaudeCodeConnector({
        folder: 'C:\\r',
        spawn: missing,
        folderExists: () => true,
      }).check(),
    ).toEqual({
      ok: false,
      error: 'Claude Code is not installed, or "claude" is not on the PATH.',
    });

    const { spawn } = fakeSpawn(['x'], 2, 'boom');
    expect(
      await new ClaudeCodeConnector({ folder: 'C:\\r', spawn, folderExists: () => true }).check(),
    ).toEqual({ ok: false, error: 'Claude Code did not start: boom' });
  });
});
