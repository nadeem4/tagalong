import { SECRET_FILES } from '@tagalong/protocol';
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { hideSecrets } from '../privacy/secrets';
import {
  CANCELLED,
  renderBrief,
  type Brief,
  type CheckResult,
  type Connector,
  type ConnectorResult,
  type ConnectorUsage,
  type NoteQueue,
  type StepKind,
} from './connector';

/** The slice of a child process the connector needs, so tests never start a real claude. */
export interface ChildRun {
  /** Writes to stdin, which stays open: a stream-json session reads one message per line. */
  write(text: string): void;
  /** Closes stdin: Claude Code finishes its last turn and exits. */
  end(): void;
  /** stdout, one line at a time. */
  lines: AsyncIterable<string>;
  /** Resolves with the exit code, or null when the process was killed. */
  exit: Promise<number | null>;
  /** Everything written to stderr so far. */
  stderr(): string;
  kill(): void;
}

export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildRun;

export interface ClaudeCodeOptions {
  /** The one folder this expert may work in. A hand-off always names one. */
  folder?: string;
  /** False (the default) keeps it to reading and searching; true also lets it edit files there. */
  canEdit?: boolean;
  /** True also lets it search and fetch the web. Still sealed: no MCP, no hooks. */
  canSearchWeb?: boolean;
  /** Standing instructions, appended to Claude Code's own system prompt on every run. */
  instructions?: string;
  command?: string;
  spawn?: SpawnFn;
  folderExists?: (folder: string) => boolean;
  /**
   * Research with no project: a routine's pre-approved hand-off. It may only search and
   * fetch the web, from an empty folder, and never edits, whatever `canEdit` says.
   */
  research?: boolean;
  /** The empty folder research runs in. Defaults to one in the temp folder. */
  researchFolder?: () => string;
}

/** An empty folder of Tagalong's own, so research has no project files to read. */
function defaultResearchFolder(): string {
  const folder = join(tmpdir(), 'tagalong-research');
  mkdirSync(folder, { recursive: true });
  return folder;
}

const NOT_INSTALLED = 'Claude Code is not installed, or "claude" is not on the PATH.';

const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const EDIT_TOOLS = ['Edit', 'Write'];
const WEB_TOOLS = ['WebSearch', 'WebFetch'];

/**
 * Claude Code reads files for itself, so the built-in blind spots go with the brief: it may
 * not read or edit a secret file anywhere in the folder. Deny rules win over allowed tools.
 */
const SECRET_FILE_RULES = SECRET_FILES.flatMap((file) => [`Read(**/${file})`, `Edit(**/${file})`]);

/** `--settings` sits above user settings, so no hook from any settings file runs. */
const SEALED_SETTINGS = JSON.stringify({ disableAllHooks: true });

/**
 * Claude Code as an expert: runs `claude -p` headless in the expert's folder, feeds it the
 * brief on stdin (no command-line length limit, no quoting), and reads its stream-json.
 * Tools outside the allowed list are refused without asking, so a read-only expert cannot
 * write even if the brief asks it to.
 */
export class ClaudeCodeConnector implements Connector {
  private readonly spawn: SpawnFn;

  constructor(private readonly options: ClaudeCodeOptions) {
    this.spawn = options.spawn ?? spawnChild;
  }

  async check(): Promise<CheckResult> {
    const { folder } = this.options;
    if (folder !== undefined && !(this.options.folderExists ?? existsSync)(folder)) {
      return { ok: false, error: `The folder ${folder} does not exist.` };
    }
    let child: ChildRun;
    try {
      child = this.spawn(this.options.command ?? 'claude', ['--version'], {
        cwd: folder ?? tmpdir(),
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT')
        return { ok: false, error: NOT_INSTALLED };
      return { ok: false, error: `Claude Code did not start: ${(error as Error).message}` };
    }
    child.end();
    for await (const line of child.lines) void line;
    const code = await child.exit;
    if (code === 0) return { ok: true };
    return {
      ok: false,
      error: `Claude Code did not start: ${child.stderr().trim() || `exit code ${code}`}`,
    };
  }

  async send(
    brief: Brief,
    onProgress: (step: string, kind?: StepKind) => void,
    signal?: AbortSignal,
    notes?: NoteQueue,
  ): Promise<ConnectorResult> {
    if (signal?.aborted) return CANCELLED;
    const research = this.options.research === true;
    const folder = research
      ? (this.options.researchFolder ?? defaultResearchFolder)()
      : this.options.folder;
    if (folder === undefined) return { ok: false, error: 'No project folder was chosen.' };
    const canEdit = !research && this.options.canEdit === true;
    const web = !research && this.options.canSearchWeb === true;
    const tools = [
      ...(research ? WEB_TOOLS : READ_TOOLS),
      ...(web ? WEB_TOOLS : []),
      ...(canEdit ? EDIT_TOOLS : []),
    ];
    // Standing instructions go in a file: the claude.cmd shim runs under cmd.exe, where a
    // multi-line argument does not survive. Removed once the run ends.
    // send() never throws, so a temp folder that cannot be written fails the run instead.
    const instructions = this.options.instructions?.trim() ?? '';
    let promptDir: string | undefined;
    let promptFile: string | undefined;
    if (instructions !== '') {
      try {
        promptDir = mkdtempSync(join(tmpdir(), 'tagalong-instructions-'));
        promptFile = join(promptDir, 'instructions.md');
        writeFileSync(promptFile, hideSecrets(instructions), 'utf8');
      } catch (error) {
        removeQuietly(promptDir);
        return {
          ok: false,
          error: `Could not write the standing instructions: ${(error as Error).message}`,
        };
      }
    }
    try {
      return await this.run(brief, onProgress, folder, canEdit, tools, promptFile, signal, notes);
    } finally {
      removeQuietly(promptDir);
    }
  }

  private async run(
    brief: Brief,
    onProgress: (step: string, kind?: StepKind) => void,
    folder: string,
    canEdit: boolean,
    tools: readonly string[],
    promptFile: string | undefined,
    signal: AbortSignal | undefined,
    notes: NoteQueue | undefined,
  ): Promise<ConnectorResult> {
    const args = [
      '-p',
      // Messages in as JSON lines too: the session stays alive between turns until stdin
      // closes, so a note from the person can follow in the same session.
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      canEdit ? 'acceptEdits' : 'dontAsk',
      ...(promptFile ? ['--append-system-prompt-file', promptFile] : []),
      // Sealed: only these built-in tools exist in the run; no MCP servers (strict, and no
      // --mcp-config); no project or local settings, so a folder's .claude/settings.json
      // cannot add permissions or hooks; and no hooks at all, user ones included. Reusing the
      // person's own MCP servers is for the Expert catalog feature, not this connector.
      '--tools',
      tools.join(','),
      '--strict-mcp-config',
      '--setting-sources',
      'user',
      '--settings',
      SEALED_SETTINGS,
      '--allowedTools',
      ...tools,
      '--disallowedTools',
      'mcp__*',
      ...SECRET_FILE_RULES,
    ];

    let child: ChildRun;
    try {
      child = this.spawn(this.options.command ?? 'claude', args, { cwd: folder });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return {
          ok: false,
          error: 'Claude Code is not installed, or "claude" is not on the PATH.',
        };
      }
      return { ok: false, error: `Claude Code could not start: ${(error as Error).message}` };
    }

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      child.end();
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child.write(userMessage(renderBrief(brief)));
      const changed = new Set<string>();
      let final: ConnectorResult | undefined;
      let model = '';
      // Every `result` reports its own turn's tokens, so a session that took notes adds up.
      let spent: ConnectorUsage | undefined;

      // A line it wrote is said only once a tool follows: the text before a `result` is the
      // answer, which Scout reads out when the run finishes.
      let toSay: string | undefined;

      for await (const line of child.lines) {
        const event = parse(line);
        if (!event) continue;
        if (event.type === 'system' && typeof event.model === 'string') {
          model = event.model;
        } else if (event.type === 'assistant') {
          for (const block of event.message?.content ?? []) {
            if (block.type === 'text') {
              toSay = firstSentence(block.text) ?? toSay;
              continue;
            }
            if (block.type !== 'tool_use') continue;
            if (toSay) onProgress(toSay, 'say');
            toSay = undefined;
            const step = describeTool(block.name, block.input);
            if (step) onProgress(step, 'tool');
            if (EDIT_TOOLS.includes(block.name) && typeof block.input?.file_path === 'string') {
              changed.add(block.input.file_path);
            }
          }
        } else if (event.type === 'result') {
          toSay = undefined;
          const text = event.result ?? '';
          const turn = usageOf(event, model);
          if (turn) {
            spent = {
              model,
              inputTokens: (spent?.inputTokens ?? 0) + turn.inputTokens,
              outputTokens: (spent?.outputTokens ?? 0) + turn.outputTokens,
            };
          }
          const usage = spent ? { usage: spent } : {};
          final = event.is_error
            ? { ok: false, error: text, ...usage }
            : { ok: true, text, changedFiles: [...changed], ...usage };
          // The turn is over. Notes waiting from the person go in as the next message, in
          // the same session; with none, stdin closes and this result is the answer. Once
          // stopped, nothing more is taken or written: a note is never passed on after Stop.
          const waiting = event.is_error || cancelled ? [] : (notes?.take() ?? []);
          if (waiting.length > 0) {
            const list = waiting.map((note) => `- ${note}`).join('\n');
            child.write(userMessage(hideSecrets(`From the person, while you worked:\n${list}`)));
          } else {
            child.end();
          }
        }
      }

      const code = await child.exit;
      if (cancelled) return CANCELLED;
      if (final) return final;
      const said = child.stderr().trim();
      return { ok: false, error: `Claude Code stopped: ${said || `exit code ${code}`}` };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      // Every way out closes stdin (closing it twice is harmless), so a session that is
      // still alive between turns never waits on a message that will not come.
      child.end();
    }
  }
}

/** A file Windows still holds must not turn a finished run into a failure. */
function removeQuietly(dir: string | undefined): void {
  if (dir === undefined) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Left in the temp folder; the OS clears it.
  }
}

/** One user message as `--input-format stream-json` reads it: a JSON object on one line. */
function userMessage(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

/** The most a spoken line from the expert's narration may be. */
const SAY_CHARS = 120;

/** The first sentence of what the expert wrote, secrets hidden, short enough to say aloud. */
function firstSentence(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const plain = hideSecrets(text).replace(/\s+/g, ' ').trim();
  if (plain === '') return undefined;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length <= SAY_CHARS ? sentence : `${sentence.slice(0, SAY_CHARS - 1)}…`;
}

interface ToolInput {
  file_path?: unknown;
  pattern?: unknown;
}

interface StreamEvent {
  type?: string;
  is_error?: boolean;
  result?: string;
  /** On the `system` init event: the model the run uses. */
  model?: unknown;
  usage?: null | {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  message?: { content?: { type: string; name: string; text?: unknown; input?: ToolInput }[] };
}

/**
 * One turn's tokens from its `result` event, for the cost meter: in a live session each
 * `result` counts only its own turn. Cache reads and writes count as input: on a cached run
 * `input_tokens` alone is a handful. Tokens only, never `total_cost_usd`: on the person's
 * plan that number is not money they pay.
 */
function usageOf(event: StreamEvent, model: string): ConnectorUsage | undefined {
  const usage = event.usage;
  // The stream is untrusted JSON: a null or non-object usage is no usage, never a crash.
  if (typeof usage !== 'object' || usage === null) return undefined;
  const count = (n: number | undefined) => (typeof n === 'number' && n > 0 ? Math.round(n) : 0);
  return {
    model,
    inputTokens:
      count(usage.input_tokens) +
      count(usage.cache_creation_input_tokens) +
      count(usage.cache_read_input_tokens),
    outputTokens: count(usage.output_tokens),
  };
}

function parse(line: string): StreamEvent | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as StreamEvent) : undefined;
  } catch {
    return undefined;
  }
}

function describeTool(name: string, input: ToolInput | undefined): string | undefined {
  const path = typeof input?.file_path === 'string' ? input.file_path : undefined;
  const pattern = typeof input?.pattern === 'string' ? input.pattern : undefined;
  switch (name) {
    case 'Read':
      return path && `Reading ${path}`;
    case 'Glob':
    case 'Grep':
      return pattern && `Searching for ${pattern}`;
    case 'Edit':
    case 'Write':
      return path && `Editing ${path}`;
    default:
      return undefined;
  }
}

/**
 * Starts a process without a shell. cross-spawn finds npm's `claude.cmd` shim on Windows,
 * which a plain spawn misses, and quotes every argument for cmd.exe so the JSON settings
 * and the deny rules arrive intact.
 */
export function spawnChild(command: string, args: string[], { cwd }: { cwd: string }): ChildRun {
  // Default stdio is three pipes, so none of the streams is null.
  const child = crossSpawn(command, args, {
    cwd,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  // A process that exits before reading the brief fails the write with EOF or EPIPE. The
  // exit code already says the run failed; unhandled, the error would take the engine down.
  child.stdin.on('error', () => undefined);
  let stderr = '';
  let killed = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  // A missing binary arrives as an 'error' event; the exit promise reports it as a failed run.
  const exit = new Promise<number | null>((resolve) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      stderr = error.code === 'ENOENT' ? `"${command}" was not found on the PATH.` : error.message;
      resolve(-1);
    });
    child.on('close', (code) => resolve(killed ? null : code));
  });
  return {
    write: (text) => {
      child.stdin.write(text);
    },
    end: () => {
      child.stdin.end();
    },
    lines: createInterface({ input: child.stdout }),
    exit,
    stderr: () => stderr,
    kill: () => {
      killed = true;
      // An npm shim runs claude under cmd.exe, so on Windows the whole tree must go.
      if (process.platform === 'win32' && child.pid !== undefined) {
        nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        }).on('error', () => child.kill());
      } else {
        child.kill();
      }
    },
  };
}
