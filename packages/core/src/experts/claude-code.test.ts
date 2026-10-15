import { SECRET_FILES } from '@tagalong/protocol';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCodeConnector, spawnChild, type ChildRun, type SpawnFn } from './claude-code';

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
      '--tools',
      'Read,Glob,Grep',
      '--strict-mcp-config',
      '--setting-sources',
      'user',
      '--settings',
      '{"disableAllHooks":true}',
      '--allowedTools',
      'Read',
      'Glob',
      'Grep',
      '--disallowedTools',
      'mcp__*',
      ...SECRET_FILES.flatMap((file) => [`Read(**/${file})`, `Edit(**/${file})`]),
    ]);
    expect(call?.stdin).toBe('Explain main.ts');
  });

  it('researches with no project: web search and fetch only, in an empty folder, never edits', async () => {
    const { spawn, calls } = fakeSpawn([result('Three papers.')]);
    const connector = new ClaudeCodeConnector({
      research: true,
      canEdit: true,
      spawn,
      researchFolder: () => 'C:\\tmp\\tagalong-research',
    });
    const outcome = await connector.send({ ask: 'New papers on agents' }, () => {});
    expect(outcome).toMatchObject({ ok: true, text: 'Three papers.' });
    const [call] = calls;
    expect(call?.cwd).toBe('C:\\tmp\\tagalong-research');
    expect(call?.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--tools',
      'WebSearch,WebFetch',
      '--strict-mcp-config',
      '--setting-sources',
      'user',
      '--settings',
      '{"disableAllHooks":true}',
      '--allowedTools',
      'WebSearch',
      'WebFetch',
      '--disallowedTools',
      'mcp__*',
      ...SECRET_FILES.flatMap((file) => [`Read(**/${file})`, `Edit(**/${file})`]),
    ]);
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
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Edit,Write');
  });

  it('hands standing instructions over as a file, with secrets hidden, and removes it after', async () => {
    const seen: { path: string; text: string }[] = [];
    const { spawn: base, calls } = fakeSpawn([result('ok')]);
    const spawn: SpawnFn = (command, args, options) => {
      const path = args[args.indexOf('--append-system-prompt-file') + 1] ?? '';
      seen.push({ path, text: readFileSync(path, 'utf8') });
      return base(command, args, options);
    };
    const key = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123';
    await new ClaudeCodeConnector({
      folder: 'C:\\r',
      instructions: `Find the cause first.\nNever paste ${key}.`,
      spawn,
    }).send({ ask: 'Why does it crash?' }, () => {});

    const args = calls[0]?.args ?? [];
    expect(args).toContain('--append-system-prompt-file');
    expect(seen[0]?.text).toBe('Find the cause first.\nNever paste [hidden: API key].');
    expect(existsSync(seen[0]?.path ?? '')).toBe(false);
    expect(calls[0]?.stdin).toBe('Why does it crash?');
  });

  it('removes the instructions file when the run fails, cannot start or is stopped', async () => {
    const files: string[] = [];
    const watching =
      (base: SpawnFn): SpawnFn =>
      (command, args, options) => {
        files.push(args[args.indexOf('--append-system-prompt-file') + 1] ?? '');
        return base(command, args, options);
      };
    const instructions = 'Find the cause first.';

    const failed = await new ClaudeCodeConnector({
      folder: 'C:\\r',
      instructions,
      spawn: watching(fakeSpawn([result('Boom.', true)]).spawn),
    }).send({ ask: 'x' }, () => {});
    expect(failed.ok).toBe(false);

    const missing = await new ClaudeCodeConnector({
      folder: 'C:\\r',
      instructions,
      spawn: watching(() => {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      }),
    }).send({ ask: 'x' }, () => {});
    expect(missing.ok).toBe(false);

    const controller = new AbortController();
    const pending = new ClaudeCodeConnector({
      folder: 'C:\\r',
      instructions,
      spawn: watching(fakeSpawn([]).spawn),
    }).send({ ask: 'x' }, () => {}, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });

    expect(files).toHaveLength(3);
    for (const file of files) expect(existsSync(file)).toBe(false);
  });

  it('keeps standing instructions in research mode, which stays web-only', async () => {
    const { spawn, calls } = fakeSpawn([result('ok')]);
    await new ClaudeCodeConnector({
      research: true,
      researchFolder: () => 'C:\\empty',
      instructions: 'Link every source.',
      canEdit: true,
      canSearchWeb: true,
      spawn,
    }).send({ ask: 'x' }, () => {});
    const args = calls[0]?.args ?? [];
    expect(args).toContain('--append-system-prompt-file');
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
  });

  describe('when the temp folder cannot be written', () => {
    const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('fails the run with a reason instead of throwing, and starts nothing', async () => {
      const gone = join(tmpdir(), 'tagalong-no-such-folder', 'deeper');
      process.env.TMPDIR = gone;
      process.env.TMP = gone;
      process.env.TEMP = gone;
      const { spawn, calls } = fakeSpawn([result('ok')]);
      const out = await new ClaudeCodeConnector({
        folder: 'C:\\r',
        instructions: 'Find the cause first.',
        spawn,
      }).send({ ask: 'x' }, () => {});
      expect(out.ok).toBe(false);
      expect(out.ok ? '' : out.error).toMatch(/^Could not write the standing instructions: /);
      expect(calls).toHaveLength(0);
    });
  });

  it('adds no prompt file when there are no standing instructions', async () => {
    const { spawn, calls } = fakeSpawn([result('ok')]);
    await new ClaudeCodeConnector({ folder: 'C:\\r', instructions: '  ', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(calls[0]?.args).not.toContain('--append-system-prompt-file');
  });

  it('may search and fetch the web when the expert is allowed to, still sealed', async () => {
    const { spawn, calls } = fakeSpawn([result('ok')]);
    await new ClaudeCodeConnector({ folder: 'C:\\r', canSearchWeb: true, spawn }).send(
      { ask: 'x' },
      () => {},
    );
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,WebSearch,WebFetch');
    expect(
      args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools')),
    ).toEqual(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']);
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('Read(**/.env)');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
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

  it('reads the tokens from the result event, cache reads counted as input', async () => {
    const { spawn } = fakeSpawn([
      { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
      {
        ...result('Done.'),
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
          output_tokens: 150,
        },
      },
    ]);
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({
      ok: true,
      text: 'Done.',
      changedFiles: [],
      usage: { model: 'claude-sonnet-5', inputTokens: 3210, outputTokens: 150 },
    });
  });

  it('keeps the tokens of a run that ended in an error', async () => {
    const { spawn } = fakeSpawn([
      { ...result('Ran out of turns.', true), usage: { input_tokens: 5, output_tokens: 7 } },
    ]);
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
    );
    expect(out).toEqual({
      ok: false,
      error: 'Ran out of turns.',
      usage: { model: '', inputTokens: 5, outputTokens: 7 },
    });
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

describe('spawnChild', () => {
  let dir: string;
  let path: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagalong-spawn-'));
    path = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing command as a failed run, even after writing the brief', async () => {
    const child = spawnChild('tagalong-no-such-command', ['-p'], { cwd: dir });
    child.write('x'.repeat(1 << 20));
    for await (const line of child.lines) void line;
    expect(await child.exit).toBe(-1);
    expect(child.stderr()).toMatch(/not found on the PATH/);
  });

  it('survives a process that exits before reading the brief', async () => {
    const child = spawnChild(process.execPath, ['-e', 'setTimeout(() => process.exit(3), 200)'], {
      cwd: dir,
    });
    const errors: unknown[] = [];
    const onUncaught = (error: unknown) => errors.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      child.write('x'.repeat(1 << 22));
      for await (const line of child.lines) void line;
      expect(await child.exit).toBe(3);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off('uncaughtException', onUncaught);
    }
    expect(errors).toEqual([]);
  });

  it.runIf(process.platform === 'win32')(
    'runs an npm .cmd shim on Windows, with every argument intact',
    async () => {
      writeFileSync(
        join(dir, 'echo-args.js'),
        'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify(process.argv.slice(2))));',
      );
      writeFileSync(join(dir, 'fake-claude.cmd'), '@node "%~dp0echo-args.js" %*\r\n');
      process.env.PATH = `${dir};${path ?? ''}`;
      const args = [
        '--settings',
        '{"disableAllHooks":true}',
        'Read(**/.env)',
        'mcp__*',
        'a b',
        '--append-system-prompt-file',
        'C:\\Users\\Jo Doe\\AppData\\Local\\Temp\\tagalong-instructions-a1\\instructions.md',
      ];

      const child = spawnChild('fake-claude', args, { cwd: dir });
      child.write('brief');
      const lines: string[] = [];
      for await (const line of child.lines) lines.push(line);

      expect(await child.exit).toBe(0);
      expect(JSON.parse(lines.join(''))).toEqual(args);
    },
  );

  it.runIf(process.platform === 'win32')(
    'kills the whole process tree under a .cmd shim',
    async () => {
      writeFileSync(join(dir, 'wait.js'), 'setInterval(() => console.log("working"), 100);');
      writeFileSync(join(dir, 'slow-claude.cmd'), '@node "%~dp0wait.js" %*\r\n');
      process.env.PATH = `${dir};${path ?? ''}`;

      const child = spawnChild('slow-claude', [], { cwd: dir });
      child.write('');
      for await (const line of child.lines) {
        void line;
        child.kill();
      }

      expect(await child.exit).toBeNull();
    },
  );
});
