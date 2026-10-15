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
  ended: boolean;
}

/** A stand-in for the claude process: replays stream-json lines, then exits. */
function fakeSpawn(
  lines: unknown[],
  exitCode = 0,
  stderr = '',
): { spawn: SpawnFn; calls: Spawned[] } {
  const calls: Spawned[] = [];
  const spawn: SpawnFn = (command, args, { cwd }) => {
    const call: Spawned = { command, args, cwd, stdin: '', killed: false, ended: false };
    calls.push(call);
    let release: () => void = () => {};
    const killed = new Promise<void>((resolve) => (release = resolve));
    const run: ChildRun = {
      write: (text) => {
        call.stdin += text;
      },
      end: () => {
        call.ended = true;
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

/** The brief or a note as Claude Code's stream-json input reads it: one user message per line. */
const userLine = (text: string) =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/**
 * A claude that stays alive between turns, as `--input-format stream-json` does: it replays
 * one turn's lines, then waits for the next user message (the next turn) or for stdin to end.
 */
function turnSpawn(turns: unknown[][]): { spawn: SpawnFn; calls: Spawned[] } {
  const calls: Spawned[] = [];
  const spawn: SpawnFn = (command, args, { cwd }) => {
    const call: Spawned = { command, args, cwd, stdin: '', killed: false, ended: false };
    calls.push(call);
    let wake: () => void = () => {};
    const wait = () => new Promise<void>((resolve) => (wake = resolve));
    let messages = 0;
    return {
      write: (text) => {
        call.stdin += text;
        messages += 1;
        wake();
      },
      end: () => {
        call.ended = true;
        wake();
      },
      lines: (async function* () {
        for (let turn = 0; turn < turns.length; turn += 1) {
          while (messages <= turn && !call.ended && !call.killed) await wait();
          if (call.ended || call.killed) return;
          for (const line of turns[turn] ?? []) yield JSON.stringify(line);
        }
      })(),
      exit: Promise.resolve(0),
      stderr: () => '',
      kill: () => {
        call.killed = true;
        wake();
      },
    };
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
      '--input-format',
      'stream-json',
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
    expect(call?.stdin).toBe(userLine('Explain main.ts'));
    expect(call?.ended).toBe(true);
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
      '--input-format',
      'stream-json',
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
    expect(calls[0]?.stdin).toBe(userLine('Why does it crash?'));
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
    const progress: [string, string | undefined][] = [];
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      (s, kind) => progress.push([s, kind]),
    );
    expect(progress).toEqual([
      ['Reading src/main.ts', 'tool'],
      ['Searching for boot', 'tool'],
      // The last text before the result is the answer: it is not narrated.
    ]);
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

  it('reads a result whose usage is missing, null or malformed without failing the run', async () => {
    const send = async (usage: unknown) => {
      const { spawn } = fakeSpawn([{ ...result('Done.'), usage }]);
      return new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send({ ask: 'x' }, () => {});
    };
    const done = { ok: true, text: 'Done.', changedFiles: [] };
    expect(await send(null)).toEqual(done);
    expect(await send('lots')).toEqual(done);
    expect(await send({ input_tokens: '12', output_tokens: -3 })).toEqual({
      ...done,
      usage: { model: '', inputTokens: 0, outputTokens: 0 },
    });
    expect(await send({ output_tokens: 9 })).toEqual({
      ...done,
      usage: { model: '', inputTokens: 0, outputTokens: 9 },
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

  describe('notes from the person, in the same live session', () => {
    const queue = (batches: string[][]) => {
      const taken: number[] = [];
      return {
        taken,
        notes: {
          take: () => {
            taken.push(1);
            return batches.shift() ?? [];
          },
        },
      };
    };

    it('writes waiting notes after the turn ends and reads on to the next result', async () => {
      const { spawn, calls } = turnSpawn([
        [
          assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }]),
          result('Used moment.'),
        ],
        [
          assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'b.ts' } }]),
          result('Switched to dayjs.'),
        ],
      ]);
      const { notes } = queue([['use dayjs, not moment']]);
      const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn, canEdit: true }).send(
        { ask: 'Fix the dates' },
        () => {},
        undefined,
        notes,
      );

      expect(out).toEqual({ ok: true, text: 'Switched to dayjs.', changedFiles: ['a.ts', 'b.ts'] });
      expect(calls[0]?.stdin).toBe(
        userLine('Fix the dates') +
          userLine('From the person, while you worked:\n- use dayjs, not moment'),
      );
      expect(calls[0]?.ended).toBe(true);
    });

    // Each `result` of a live session reports that turn's tokens only (claude 2.1.300), so
    // the run's usage is the sum over every turn, not the last one.
    it('adds up the tokens of every turn in the session', async () => {
      const { spawn } = turnSpawn([
        [
          { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
          {
            ...result('Used moment.'),
            usage: { input_tokens: 2, cache_read_input_tokens: 600, output_tokens: 3 },
          },
        ],
        [
          {
            ...result('Switched to dayjs.'),
            usage: { input_tokens: 2, cache_creation_input_tokens: 4000, output_tokens: 350 },
          },
        ],
        [result('Also fixed the test.')],
      ]);
      const { notes } = queue([['use dayjs, not moment'], ['fix the test too']]);
      const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'Fix the dates' },
        () => {},
        undefined,
        notes,
      );

      expect(out).toEqual({
        ok: true,
        text: 'Also fixed the test.',
        changedFiles: [],
        usage: { model: 'claude-sonnet-5', inputTokens: 4604, outputTokens: 353 },
      });
    });

    it('keeps the earlier turns’ tokens when a later turn ends in an error', async () => {
      const { spawn } = turnSpawn([
        [{ ...result('Used moment.'), usage: { input_tokens: 10, output_tokens: 20 } }],
        [{ ...result('Ran out of turns.', true), usage: { input_tokens: 1, output_tokens: 2 } }],
      ]);
      const { notes } = queue([['use dayjs']]);
      const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'x' },
        () => {},
        undefined,
        notes,
      );

      expect(out).toEqual({
        ok: false,
        error: 'Ran out of turns.',
        usage: { model: '', inputTokens: 11, outputTokens: 22 },
      });
    });

    it('ends stdin after the first result when no note is waiting', async () => {
      const { spawn, calls } = turnSpawn([[result('Done.')], [result('never')]]);
      const { notes, taken } = queue([]);
      const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'x' },
        () => {},
        undefined,
        notes,
      );
      expect(out).toMatchObject({ ok: true, text: 'Done.' });
      expect(taken).toHaveLength(1);
      expect(calls[0]?.ended).toBe(true);
      expect(calls[0]?.stdin).toBe(userLine('x'));
    });

    it('takes no notes after an error result: the run ends with it', async () => {
      const { spawn, calls } = turnSpawn([[result('Ran out of turns.', true)]]);
      const { notes, taken } = queue([['too late']]);
      const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'x' },
        () => {},
        undefined,
        notes,
      );
      expect(out).toEqual({ ok: false, error: 'Ran out of turns.' });
      expect(taken).toHaveLength(0);
      expect(calls[0]?.ended).toBe(true);
    });

    it('hides secrets in a note before it is written', async () => {
      const { spawn, calls } = turnSpawn([[result('one')], [result('two')]]);
      const { notes } = queue([['the key is sk-ant-abcdefghijklmnopqrstuvwxyz0123']]);
      await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'x' },
        () => {},
        undefined,
        notes,
      );
      expect(calls[0]?.stdin).not.toContain('sk-ant-');
      expect(calls[0]?.stdin).toContain('[hidden: API key]');
    });

    it('kills the session when stopped while it waits between turns', async () => {
      // The first turn never ends: the session sits waiting until Stop.
      const { spawn, calls } = turnSpawn([
        [assistant([{ type: 'text', text: 'Looking.' }])],
        [result('never')],
      ]);
      const controller = new AbortController();
      const pending = new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
        { ask: 'x' },
        () => {},
        controller.signal,
        queue([]).notes,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
      expect(calls[0]?.killed).toBe(true);
      expect(calls[0]?.ended).toBe(true);
    });
  });

  it('says the first sentence of what Claude Code writes, clipped, with secrets hidden', async () => {
    const long = `Found the bug in ${'very '.repeat(40)}long names. Then more.`;
    const read = { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } };
    const { spawn } = fakeSpawn([
      assistant([{ type: 'text', text: 'Found the bug in `date.ts`. Fixing it next.' }, read]),
      assistant([{ type: 'text', text: '  \n ' }, read]),
      assistant([{ type: 'text', text: 'Key: sk-ant-abcdefghijklmnopqrstuvwxyz0123 is in .env.' }]),
      assistant([read]),
      assistant([{ type: 'text', text: long }, read]),
      result('ok'),
    ]);
    const says: string[] = [];
    await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send({ ask: 'x' }, (s, kind) => {
      if (kind === 'say') says.push(s);
    });
    expect(says[0]).toBe('Found the bug in `date.ts`.');
    expect(says[1]).toBe('Key: [hidden: API key] is in .env.');
    expect(says[2]?.length).toBeLessThanOrEqual(120);
    expect(says[2]?.endsWith('…')).toBe(true);
    expect(says).toHaveLength(3);
  });

  it('never says the final answer: only what it writes between tools', async () => {
    const { spawn } = fakeSpawn([
      assistant([{ type: 'text', text: 'Looking at the dates.' }]),
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: 'date.ts' } }]),
      assistant([{ type: 'text', text: 'The bug is an off-by-one. Here is the fix.' }]),
      result('The bug is an off-by-one. Here is the fix.'),
    ]);
    const steps: string[] = [];
    await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send({ ask: 'x' }, (s, kind) =>
      steps.push(`${kind}:${s}`),
    );
    expect(steps).toEqual(['say:Looking at the dates.', 'tool:Reading date.ts']);
  });

  it('kills the process when the hand-off is cancelled, and closes its stdin', async () => {
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
    expect(calls[0]?.ended).toBe(true);
  });

  it('closes stdin when claude exits with no result', async () => {
    const { spawn, calls } = fakeSpawn([assistant([{ type: 'text', text: 'Hm.' }])], 1, 'boom');
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
      undefined,
      { take: () => ['never'] },
    );
    expect(out).toEqual({ ok: false, error: 'Claude Code stopped: boom' });
    expect(calls[0]?.ended).toBe(true);
  });

  it('closes stdin when reading its output fails', async () => {
    let ended = false;
    const spawn: SpawnFn = () => ({
      write: () => {},
      end: () => {
        ended = true;
      },
      lines: (async function* () {
        yield JSON.stringify(assistant([]));
        throw new Error('stream broke');
      })(),
      exit: Promise.resolve(1),
      stderr: () => '',
      kill: () => {},
    });
    await expect(
      new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send({ ask: 'x' }, () => {}),
    ).rejects.toThrow('stream broke');
    expect(ended).toBe(true);
  });

  it('takes no notes and writes nothing once stopped, even when a result is still on its way', async () => {
    const controller = new AbortController();
    const calls: Spawned[] = [];
    const spawn: SpawnFn = (command, args, { cwd }) => {
      const call: Spawned = { command, args, cwd, stdin: '', killed: false, ended: false };
      calls.push(call);
      return {
        write: (text) => {
          call.stdin += text;
        },
        end: () => {
          call.ended = true;
        },
        // The result was already read from the pipe when Stop came.
        lines: (async function* () {
          controller.abort();
          yield JSON.stringify(result('Done.'));
        })(),
        exit: Promise.resolve(null),
        stderr: () => '',
        kill: () => {
          call.killed = true;
        },
      };
    };
    let taken = 0;
    const out = await new ClaudeCodeConnector({ folder: 'C:\\r', spawn }).send(
      { ask: 'x' },
      () => {},
      controller.signal,
      {
        take: () => {
          taken += 1;
          return ['use dayjs'];
        },
      },
    );
    expect(out).toEqual({ ok: false, error: 'Cancelled.' });
    expect(taken).toBe(0);
    expect(calls[0]?.stdin).toBe(userLine('x'));
    expect(calls[0]?.ended).toBe(true);
  });
});

describe('ClaudeCodeConnector with a catalog bundle', () => {
  const FIRECRAWL = 'firecrawl@claude-plugins-official';
  const NOTION = 'notion@claude-plugins-official';
  const SEARCH = 'mcp__plugin_Notion_notion__notion-search';
  const init = (plugins: string[]) => ({
    type: 'system',
    subtype: 'init',
    plugins: plugins.map((source) => ({ name: source.split('@')[0], source })),
  });
  let own: string;
  beforeEach(() => {
    own = join(mkdtempSync(join(tmpdir(), 'tagalong-own-')), 'researcher');
  });

  function bundled(lines: unknown[], extra: Partial<ConstructorParameters<typeof ClaudeCodeConnector>[0]> = {}) {
    const { spawn, calls } = fakeSpawn(lines);
    const connector = new ClaudeCodeConnector({
      spawn,
      canSearchWeb: true,
      plugins: [FIRECRAWL, NOTION],
      mcpTools: [SEARCH],
      installedPlugins: () => [FIRECRAWL, NOTION, 'superpowers@claude-plugins-official'],
      ownFolder: own,
      ...extra,
    });
    return { connector, calls };
  }

  it('pins its plugins, turns every other one off, and allows exactly its app tools', async () => {
    const { connector, calls } = bundled([init([FIRECRAWL, NOTION]), result('Found it.')]);
    const outcome = await connector.send({ ask: 'Find papers' }, () => {});
    expect(outcome).toMatchObject({ ok: true, text: 'Found it.' });
    expect(calls[0]?.args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--tools',
      'Read,Glob,Grep,WebSearch,WebFetch,Skill',
      '--setting-sources',
      'user',
      '--settings',
      JSON.stringify({
        disableAllHooks: true,
        enabledPlugins: {
          [FIRECRAWL]: true,
          [NOTION]: true,
          'superpowers@claude-plugins-official': false,
        },
      }),
      '--allowedTools',
      'Read',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
      'Skill',
      SEARCH,
      '--disallowedTools',
      ...SECRET_FILES.flatMap((file) => [`Read(**/${file})`, `Edit(**/${file})`]),
    ]);
  });

  it('works in its own folder, made if needed, never in a project', async () => {
    const { connector, calls } = bundled([init([FIRECRAWL, NOTION]), result('ok')], {
      folder: 'C:\projects\site',
    });
    await connector.send({ ask: 'x' }, () => {});
    expect(calls[0]?.cwd).toBe(own);
    expect(existsSync(own)).toBe(true);
  });

  it('writes drafts there without asking, but anything else unlisted is still refused', async () => {
    const { connector, calls } = bundled([init([FIRECRAWL, NOTION]), result('ok')], {
      canEdit: true,
    });
    await connector.send({ ask: 'x' }, () => {});
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,WebSearch,WebFetch,Edit,Write,Skill');
  });

  it('refuses to run when Claude Code did not load a pinned plugin', async () => {
    const { connector, calls } = bundled([init([NOTION]), result('should not get here')]);
    const outcome = await connector.send({ ask: 'x' }, () => {});
    expect(outcome).toEqual({
      ok: false,
      error: `Claude Code did not load ${FIRECRAWL}, which this expert needs. Install it from Home, Experts, then try again.`,
    });
    expect(calls[0]?.killed).toBe(true);
  });

  it('refuses to run when Claude Code loaded a plugin it does not pin', async () => {
    const { connector, calls } = bundled([
      init([FIRECRAWL, NOTION, 'engineering@synced', 'cc-plugin-agents-md@builtin']),
      result('should not get here'),
    ]);
    const outcome = await connector.send({ ask: 'x' }, () => {});
    expect(outcome).toEqual({
      ok: false,
      error: 'Claude Code also loaded engineering@synced, which this expert does not use, so it did not start.',
    });
    expect(calls[0]?.killed).toBe(true);
  });

  it('refuses to run when Claude Code does not say which plugins it loaded', async () => {
    const { connector } = bundled([result('ok')]);
    expect(await connector.send({ ask: 'x' }, () => {})).toEqual({
      ok: false,
      error: 'Claude Code did not say which plugins it loaded, so this expert did not start.',
    });
  });

  it("ignores Claude Code's own built-in plugins", async () => {
    const { connector } = bundled([
      init([FIRECRAWL, NOTION, 'cc-plugin-agents-md@builtin']),
      result('ok'),
    ]);
    expect(await connector.send({ ask: 'x' }, () => {})).toMatchObject({ ok: true });
  });

  it('runs with app tools alone, no plugins, and still checks none were loaded', async () => {
    const { connector, calls } = bundled([init([]), result('ok')], {
      plugins: [],
      mcpTools: ['mcp__claude_ai_Google_Calendar__list_events'],
    });
    expect(await connector.send({ ask: 'x' }, () => {})).toMatchObject({ ok: true });
    const args = calls[0]?.args ?? [];
    expect(args).not.toContain('--strict-mcp-config');
    expect(args).toContain('mcp__claude_ai_Google_Calendar__list_events');
  });

  it('stays sealed for a routine’s research, whatever its bundle', async () => {
    const { connector, calls } = bundled([result('ok')], {
      research: true,
      researchFolder: () => 'C:\tmp\r',
    });
    await connector.send({ ask: 'x' }, () => {});
    const args = calls[0]?.args ?? [];
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('mcp__*');
    expect(args).not.toContain('Skill');
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
    child.end();
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
      child.end();
      const lines: string[] = [];
      for await (const line of child.lines) lines.push(line);

      expect(await child.exit).toBe(0);
      expect(JSON.parse(lines.join(''))).toEqual(args);
    },
    30_000,
  );

  /** A stand-in claude: one `result` per user line, alive between turns until stdin ends. */
  const SESSION_JS = [
    'const rl = require("readline").createInterface({ input: process.stdin });',
    'let turn = 0;',
    'rl.on("line", (line) => {',
    '  turn += 1;',
    '  const text = JSON.parse(line).message.content;',
    '  console.log(JSON.stringify({ type: "result", is_error: false, result: `turn ${turn}: ${text}` }));',
    '});',
    'rl.on("close", () => process.exit(0));',
  ].join('\n');

  it.runIf(process.platform === 'win32')(
    'carries a note into the same live session under a .cmd shim, and exits once stdin ends',
    async () => {
      writeFileSync(join(dir, 'session.js'), SESSION_JS);
      writeFileSync(join(dir, 'session-claude.cmd'), '@node "%~dp0session.js" %*\r\n');
      process.env.PATH = `${dir};${path ?? ''}`;
      const batches = [['use dayjs']];

      const out = await new ClaudeCodeConnector({ folder: dir, command: 'session-claude' }).send(
        { ask: 'Fix it' },
        () => {},
        undefined,
        { take: () => batches.shift() ?? [] },
      );

      expect(out).toEqual({
        ok: true,
        text: 'turn 2: From the person, while you worked:\n- use dayjs',
        changedFiles: [],
      });
    },
  );

  it.runIf(process.platform === 'win32')(
    'kills the whole session tree under a .cmd shim when stopped between turns',
    async () => {
      // Never ends a turn: it only waits, as a session does while the model works.
      writeFileSync(join(dir, 'idle.js'), 'process.stdin.resume(); setInterval(() => {}, 1000);');
      writeFileSync(join(dir, 'idle-claude.cmd'), '@node "%~dp0idle.js" %*\r\n');
      process.env.PATH = `${dir};${path ?? ''}`;
      const controller = new AbortController();
      const pending = new ClaudeCodeConnector({ folder: dir, command: 'idle-claude' }).send(
        { ask: 'x' },
        () => {},
        controller.signal,
        { take: () => [] },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      controller.abort();
      // Resolving at all means stdout closed: the node grandchild holding it is gone too.
      expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
    },
    20_000,
  );

  it.runIf(process.platform === 'win32')(
    'kills the whole process tree under a .cmd shim',
    async () => {
      // One line, then idle: the test kills once, instead of a taskkill per line.
      writeFileSync(
        join(dir, 'wait.js'),
        'console.log("working"); setInterval(() => undefined, 1000);',
      );
      writeFileSync(join(dir, 'slow-claude.cmd'), '@node "%~dp0wait.js" %*\r\n');
      process.env.PATH = `${dir};${path ?? ''}`;

      const child = spawnChild('slow-claude', [], { cwd: dir });
      child.write('');
      for await (const line of child.lines) {
        void line;
        child.kill();
        break;
      }

      expect(await child.exit).toBeNull();
    },
    // cmd.exe, node and taskkill each start a process: slow on a loaded machine, not racy.
    30_000,
  );
});
