/**
 * A brain that thinks through the person's Claude Code sign-in, so no API key is needed.
 * Contains `ClaudeCodeBrain` and `CLAUDE_CODE_MODELS`. Each step runs `claude -p` once
 * with its own tools off; the pet's tools are described in the message and called with a
 * `<tool_call>` tag.
 */
import { tmpdir } from 'node:os';
import { spawnChild, type ChildRun, type SpawnFn } from '../experts/claude-code';
import type {
  BrainCapabilities,
  BrainContent,
  BrainContentBlock,
  BrainEvents,
  BrainMessage,
  BrainProvider,
  BrainRequest,
  BrainResult,
  BrainTool,
} from './brain';
import { BrainError } from './errors';

export interface ClaudeCodeBrainOptions {
  command?: string;
  spawn?: SpawnFn;
  /** Where claude runs. A neutral folder, so no project's CLAUDE.md steers the pet. */
  cwd?: string;
}

/** The aliases claude's --model accepts, fastest first. */
export const CLAUDE_CODE_MODELS: readonly string[] = ['haiku', 'sonnet', 'opus'];

/** A pet's turn is a handful of tool calls; more than this is a loop, not a turn. */
const MAX_STEPS = 8;

const NOT_INSTALLED = 'Claude Code is not installed, or "claude" is not on the PATH.';

/** Replaces Claude Code's own coding-agent prompt; the pet's real prompt is in the message. */
const SHELL_PROMPT =
  'You are the mind of a desktop companion app. Follow the instructions in the user message exactly. You have no tools of your own; use only the tool-call format the message describes.';

/**
 * A pet that thinks through the person's Claude Code sign-in, so no API key is needed.
 *
 * Each step runs `claude -p` once with its own tools refused, the whole conversation in
 * one stream-json message (screenshots as image blocks). The pet's tools are described in
 * that message; the model calls one by replying with a single `<tool_call>` tag, which this
 * provider runs through `onToolUse` and answers in the next step. Slower than an API
 * (a process per step) but it costs nothing to set up.
 */
export class ClaudeCodeBrain implements BrainProvider {
  readonly id = 'claude-code';
  readonly capabilities: BrainCapabilities = { vision: true, tools: true };
  readonly #spawn: SpawnFn;
  readonly #command: string;
  readonly #cwd: string;

  constructor(options: ClaudeCodeBrainOptions = {}) {
    this.#spawn = options.spawn ?? spawnChild;
    this.#command = options.command ?? 'claude';
    this.#cwd = options.cwd ?? tmpdir();
  }

  async listModels(): Promise<string[]> {
    return [...CLAUDE_CODE_MODELS];
  }

  async complete(
    req: BrainRequest,
    events: BrainEvents,
    signal: AbortSignal,
  ): Promise<BrainResult> {
    const messages = [...req.messages];
    const usage = { inputTokens: 0, outputTokens: 0 };

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (signal.aborted) return { text: '', stopReason: 'aborted', usage };
      const run = await this.#run(req, messages, signal);
      if (run === null) return { text: '', stopReason: 'aborted', usage };
      usage.inputTokens += run.inputTokens;
      usage.outputTokens += run.outputTokens;

      const call = toolCallIn(run.text);
      if (call === null) {
        events.onText(run.text);
        return { text: run.text, stopReason: 'end', usage };
      }
      const id = `claude-code-${step + 1}`;
      const output = await events.onToolUse({ id, name: call.name, input: call.input });
      messages.push(
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id, name: call.name, input: call.input }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: id,
              content: output.content,
              ...(output.isError === undefined ? {} : { isError: output.isError }),
            },
          ],
        },
      );
    }
    const text = 'I went round in circles on that one. Try asking it another way.';
    events.onText(text);
    return { text, stopReason: 'end', usage };
  }

  /** One claude run. Null means the turn was stopped while it ran. */
  async #run(
    req: BrainRequest,
    messages: readonly BrainMessage[],
    signal: AbortSignal,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      req.model,
      '--system-prompt',
      SHELL_PROMPT,
      '--permission-mode',
      'dontAsk',
      // No built-in tools and none of the person's MCP servers: fewer ways to wander, and
      // a much faster start, which matters because every step is a new process.
      '--tools',
      '',
      '--strict-mcp-config',
    ];
    let child: ChildRun;
    try {
      child = this.#spawn(this.#command, args, { cwd: this.#cwd });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT')
        throw new BrainError('config', NOT_INSTALLED);
      throw new BrainError('config', `Claude Code could not start: ${(error as Error).message}`);
    }

    let stopped = false;
    const onAbort = () => {
      stopped = true;
      child.end();
      child.kill();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const line = { type: 'user', message: { role: 'user', content: render(req, messages) } };
      child.write(`${JSON.stringify(line)}\n`);
      // One message per run: closing stdin lets the stream-json session end after its reply.
      child.end();
      let final:
        { text: string; isError: boolean; inputTokens: number; outputTokens: number } | undefined;
      for await (const raw of child.lines) {
        const event = parse(raw);
        if (event?.type !== 'result') continue;
        final = {
          text: event.result ?? '',
          isError: event.is_error === true,
          inputTokens: event.usage?.input_tokens ?? 0,
          outputTokens: event.usage?.output_tokens ?? 0,
        };
      }
      const code = await child.exit;
      if (stopped) return null;
      if (final === undefined) {
        const said = child.stderr().trim();
        if (code === -1 && said.includes('not found'))
          throw new BrainError('config', NOT_INSTALLED);
        throw new BrainError('unknown', `Claude Code stopped: ${said || `exit code ${code}`}`);
      }
      if (final.isError)
        throw new BrainError('auth', `Claude Code could not answer: ${final.text}`);
      return final;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** The instructions, the tools and the conversation so far, as one message's blocks. */
function render(req: BrainRequest, messages: readonly BrainMessage[]): unknown[] {
  const blocks: unknown[] = [];
  const text = (value: string) => blocks.push({ type: 'text', text: value });
  text(`<instructions>\n${req.system}\n</instructions>`);
  if (req.tools !== undefined && req.tools.length > 0) text(toolsSection(req.tools));
  text('<conversation>');
  for (const message of messages) {
    for (const part of message.content) renderPart(message.role, part, text, blocks);
  }
  text('</conversation>\nWrite the assistant’s next reply.');
  return blocks;
}

function renderPart(
  role: BrainMessage['role'],
  part: BrainContent,
  text: (value: string) => void,
  blocks: unknown[],
): void {
  switch (part.type) {
    case 'text':
      text(`${role === 'user' ? 'User' : 'Assistant'}: ${part.text}`);
      return;
    case 'image':
      blocks.push(imageBlock(part));
      return;
    case 'tool_use':
      text(`Assistant called ${part.name} with ${JSON.stringify(part.input ?? {})}`);
      return;
    case 'tool_result': {
      text(`Tool result${part.isError === true ? ' (error)' : ''}:`);
      if (typeof part.content === 'string') text(part.content);
      else {
        for (const block of part.content) {
          if (block.type === 'text') text(block.text);
          else blocks.push(imageBlock(block));
        }
      }
      return;
    }
  }
}

function imageBlock(block: Extract<BrainContentBlock, { type: 'image' }>) {
  return { type: 'image', source: { type: 'base64', media_type: block.mime, data: block.base64 } };
}

function toolsSection(tools: readonly BrainTool[]): string {
  const list = tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}\n  input schema: ${JSON.stringify(tool.inputSchema)}`,
    )
    .join('\n');
  return [
    '<tools>',
    list,
    '</tools>',
    'To use a tool, reply with only this and nothing else:',
    '<tool_call>{"name": "<tool name>", "input": {…}}</tool_call>',
    'You will get its result, then reply again. When you have your answer, reply with the answer only.',
  ].join('\n');
}

function toolCallIn(text: string): { name: string; input: unknown } | null {
  const match = /<tool_call>([\s\S]*?)<\/tool_call>/.exec(text);
  if (match === null) return null;
  try {
    const value = JSON.parse(match[1]!.trim()) as { name?: unknown; input?: unknown };
    if (typeof value.name !== 'string') return null;
    return { name: value.name, input: value.input ?? {} };
  } catch {
    return null;
  }
}

interface ResultEvent {
  type?: string;
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parse(line: string): ResultEvent | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as ResultEvent) : undefined;
  } catch {
    return undefined;
  }
}
