import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  CANCELLED,
  renderBrief,
  type Brief,
  type CheckResult,
  type Connector,
  type ConnectorResult,
} from './connector';

/** The slice of a child process the connector needs, so tests never start a real claude. */
export interface ChildRun {
  write(text: string): void;
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
  /** The one folder this expert may work in. */
  folder: string;
  /** False (the default) keeps it to reading and searching; true also lets it edit files there. */
  canEdit?: boolean;
  command?: string;
  spawn?: SpawnFn;
  folderExists?: (folder: string) => boolean;
}

const NOT_INSTALLED = 'Claude Code is not installed, or "claude" is not on the PATH.';

const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const EDIT_TOOLS = ['Edit', 'Write'];

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
    if (!(this.options.folderExists ?? existsSync)(folder)) {
      return { ok: false, error: `The folder ${folder} does not exist.` };
    }
    let child: ChildRun;
    try {
      child = this.spawn(this.options.command ?? 'claude', ['--version'], { cwd: folder });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT')
        return { ok: false, error: NOT_INSTALLED };
      return { ok: false, error: `Claude Code did not start: ${(error as Error).message}` };
    }
    child.write('');
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
    onProgress: (step: string) => void,
    signal?: AbortSignal,
  ): Promise<ConnectorResult> {
    if (signal?.aborted) return CANCELLED;
    const canEdit = this.options.canEdit === true;
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      canEdit ? 'acceptEdits' : 'dontAsk',
      '--allowedTools',
      ...READ_TOOLS,
      ...(canEdit ? EDIT_TOOLS : []),
    ];

    let child: ChildRun;
    try {
      child = this.spawn(this.options.command ?? 'claude', args, { cwd: this.options.folder });
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
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child.write(renderBrief(brief));
      const changed = new Set<string>();
      let final: ConnectorResult | undefined;

      for await (const line of child.lines) {
        const event = parse(line);
        if (!event) continue;
        if (event.type === 'assistant') {
          for (const block of event.message?.content ?? []) {
            if (block.type !== 'tool_use') continue;
            const step = describeTool(block.name, block.input);
            if (step) onProgress(step);
            if (EDIT_TOOLS.includes(block.name) && typeof block.input?.file_path === 'string') {
              changed.add(block.input.file_path);
            }
          }
        } else if (event.type === 'result') {
          const text = event.result ?? '';
          final = event.is_error
            ? { ok: false, error: text }
            : { ok: true, text, changedFiles: [...changed] };
        }
      }

      const code = await child.exit;
      if (cancelled) return CANCELLED;
      if (final) return final;
      const said = child.stderr().trim();
      return { ok: false, error: `Claude Code stopped: ${said || `exit code ${code}`}` };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

interface ToolInput {
  file_path?: unknown;
  pattern?: unknown;
}

interface StreamEvent {
  type?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: { type: string; name: string; input?: ToolInput }[] };
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

export function spawnChild(command: string, args: string[], { cwd }: { cwd: string }): ChildRun {
  const child = nodeSpawn(command, args, { cwd, windowsHide: true });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  // A missing binary arrives as an 'error' event; the exit promise reports it as a failed run.
  const exit = new Promise<number | null>((resolve) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      stderr = error.code === 'ENOENT' ? `"${command}" was not found on the PATH.` : error.message;
      resolve(-1);
    });
    child.on('close', (code) => resolve(child.killed ? null : code));
  });
  return {
    write: (text) => {
      child.stdin.end(text);
    },
    lines: createInterface({ input: child.stdout }),
    exit,
    stderr: () => stderr,
    kill: () => child.kill(),
  };
}
