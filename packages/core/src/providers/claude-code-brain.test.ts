/** Tests for ClaudeCodeBrain: no key, the tool-call loop, failed runs and stopping. */
import { describe, expect, it, vi } from 'vitest';
import type { ChildRun, SpawnFn } from '../experts/claude-code';
import type { BrainEvents, BrainRequest } from './brain';
import { ClaudeCodeBrain } from './claude-code-brain';
import { BrainError } from './errors';

interface Spawned {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  ended: boolean;
}

/**
 * One scripted claude run per call: each run replays its stream-json lines, then, as a real
 * `--input-format stream-json` session does, stays alive until stdin ends (or it is killed).
 */
function fakeSpawn(runs: unknown[][]): { spawn: SpawnFn; calls: Spawned[] } {
  const calls: Spawned[] = [];
  const spawn: SpawnFn = (command, args, { cwd }) => {
    const call: Spawned = { command, args, cwd, stdin: '', ended: false };
    const lines = runs[calls.length] ?? [];
    calls.push(call);
    let killed = false;
    let close: () => void = () => {};
    const closed = new Promise<void>((resolve) => (close = resolve));
    const run: ChildRun = {
      write: (text) => {
        call.stdin += text;
      },
      end: () => {
        call.ended = true;
        close();
      },
      lines: (async function* () {
        for (const line of lines) {
          if (killed) return;
          yield JSON.stringify(line);
        }
        await closed;
      })(),
      exit: Promise.resolve(0),
      stderr: () => '',
      kill: () => {
        killed = true;
        close();
      },
    };
    return run;
  };
  return { spawn, calls };
}

const result = (text: string, isError = false) => ({
  type: 'result',
  is_error: isError,
  result: text,
  usage: { input_tokens: 10, output_tokens: 3 },
});

const request = (overrides: Partial<BrainRequest> = {}): BrainRequest => ({
  model: 'haiku',
  system: 'You are Scout.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Why does this test fail?' }] }],
  maxTokens: 1024,
  ...overrides,
});

function events(onToolUse: BrainEvents['onToolUse'] = async () => ({ content: '' })) {
  const text: string[] = [];
  return { text, events: { onText: (delta: string) => text.push(delta), onToolUse } };
}

/** The user message the brain wrote to claude's stdin, as stream-json. */
const sent = (call: Spawned) =>
  JSON.parse(call.stdin.trim()) as {
    type: string;
    message: { role: string; content: Record<string, unknown>[] };
  };

const textOf = (call: Spawned) =>
  sent(call)
    .message.content.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

describe('ClaudeCodeBrain', () => {
  it('needs no key: it thinks through the Claude Code sign-in, with no tools of its own', async () => {
    const { spawn, calls } = fakeSpawn([[result('It closes the database too early.')]]);
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\\tmp' });
    const { text, events: ev } = events();

    const answer = await brain.complete(request(), ev, new AbortController().signal);

    expect(answer).toEqual({
      text: 'It closes the database too early.',
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    expect(text.join('')).toBe('It closes the database too early.');
    expect(calls[0]?.command).toBe('claude');
    expect(calls[0]?.cwd).toBe('C:\\tmp');
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--model', 'haiku']),
    );
    expect(calls[0]?.args.join(' ')).toContain('--permission-mode dontAsk');
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config']));
    expect(sent(calls[0]!).type).toBe('user');
    // One message, then stdin closes: the session ends and no claude is left running.
    expect(calls[0]?.ended).toBe(true);
    expect(textOf(calls[0]!)).toContain('You are Scout.');
    expect(textOf(calls[0]!)).toContain('Why does this test fail?');
  });

  it('lists the tools, runs the one the model asks for, and sends the result back', async () => {
    const { spawn, calls } = fakeSpawn([
      [result('<tool_call>{"name":"look_at_screen","input":{"why":"see the error"}}</tool_call>')],
      [result('The port is taken.')],
    ]);
    const onToolUse = vi.fn(async () => ({
      content: [
        { type: 'text' as const, text: 'VS Code with a failing test' },
        { type: 'image' as const, mime: 'image/png' as const, base64: 'AAAA' },
      ],
    }));
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\\tmp' });
    const { text, events: ev } = events(onToolUse);

    const answer = await brain.complete(
      request({
        tools: [
          {
            name: 'look_at_screen',
            description: 'Take a screenshot.',
            inputSchema: { type: 'object' },
          },
        ],
      }),
      ev,
      new AbortController().signal,
    );

    expect(textOf(calls[0]!)).toContain('look_at_screen');
    expect(textOf(calls[0]!)).toContain('Take a screenshot.');
    expect(onToolUse).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'look_at_screen', input: { why: 'see the error' } }),
    );
    expect(textOf(calls[1]!)).toContain('VS Code with a failing test');
    expect(sent(calls[1]!).message.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(answer.text).toBe('The port is taken.');
    expect(text.join('')).toBe('The port is taken.');
    expect(answer.usage).toEqual({ inputTokens: 20, outputTokens: 6 });
  });

  it('stops with tool_limit and no text when the model keeps calling tools', async () => {
    const call = result('<tool_call>{"name":"look_at_screen","input":{}}</tool_call>');
    const { spawn, calls } = fakeSpawn(Array.from({ length: 20 }, () => [call]));
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\tmp' });
    const { text, events: ev } = events();

    const answer = await brain.complete(request(), ev, new AbortController().signal);

    expect(answer.stopReason).toBe('tool_limit');
    expect(answer.text).toBe('');
    expect(text).toEqual([]);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('says plainly when Claude Code is not installed', async () => {
    const spawn: SpawnFn = () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    };
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\\tmp' });
    const failure = brain.complete(request(), events().events, new AbortController().signal);
    await expect(failure).rejects.toBeInstanceOf(BrainError);
    await expect(failure).rejects.toThrow(/Claude Code is not installed/);
  });

  it('reports a failed run, such as being signed out, as an auth error', async () => {
    const { spawn } = fakeSpawn([[result('Invalid API key · Please run /login', true)]]);
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\\tmp' });
    const failure = brain.complete(request(), events().events, new AbortController().signal);
    await expect(failure).rejects.toMatchObject({ code: 'auth' });
    await expect(failure).rejects.toThrow(/Please run \/login/);
  });

  it('stops when the turn is stopped', async () => {
    const { spawn } = fakeSpawn([[result('too late')]]);
    const brain = new ClaudeCodeBrain({ spawn, cwd: 'C:\\tmp' });
    const controller = new AbortController();
    controller.abort();
    const answer = await brain.complete(request(), events().events, controller.signal);
    expect(answer.stopReason).toBe('aborted');
  });
});
