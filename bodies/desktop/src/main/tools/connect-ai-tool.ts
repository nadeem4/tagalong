/**
 * The desktop tool that sets Claude Code, Codex or Cursor up to use Scout's memory on this PC.
 * The brain calls it with the new client's token (never the model): it writes the bridge's
 * pairing file owner-only, runs the tool's own `mcp add` (Cursor has none, so its mcp.json is
 * edited), then starts the bridge once to see that it answers. Not declared in `hello`, so the
 * model never sees it; the token is never in a result or an error.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ErrorCode, RpcError, type Part } from '@tagalong/contract';
import { AI_TOOLS, bridgeArgv } from '@tagalong/ui/shapes';
import type { AiToolId } from '@tagalong/ui/shapes';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string;
  timeoutMs?: number;
  /** Resolve as soon as stdout holds this text, and stop the command. */
  until?: string;
}

/** All the work, first command to last, stops by then so it never outlives the brain's wait. */
export const CONNECT_BUDGET_MS = 50_000;
const PROBE_LIMIT_MS = 10_000;

export interface ConnectDeps {
  /** The brain's data folder (TAGALONG_HOME). */
  home: () => string;
  /** The address the bridge dials, and the fingerprint it pins (null for this PC's loopback). */
  brain: () => { addr: string; fingerprint: string | null };
  run: (command: string, args: string[], opts?: RunOptions) => Promise<RunResult>;
  /** How to start `tagalong`, for the one check that the bridge answers. */
  tagalong: { command: string; args: string[] };
  cursorConfig: string;
  windows: boolean;
  /** Who may read the pairing file on Windows. */
  user: string;
  budgetMs?: number;
}

const LABELS: Record<string, string> = Object.fromEntries(
  AI_TOOLS.map((tool) => [tool.id, tool.label]),
);
type AiTool = AiToolId;
const CLI = { 'claude-code': 'claude', codex: 'codex' } as const;

const bridge = bridgeArgv;

// What an AI tool sends first, then one real read: it makes the bridge dial the brain with the token.
const PROBE = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tagalong', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'list_memories', arguments: {} },
  },
]
  .map((message) => `${JSON.stringify(message)}\n`)
  .join('');

/** The bridge's answer to the read: null when it never came, else whether the brain was reached. */
function readReached(stdout: string): boolean | null {
  for (const line of stdout.split('\n')) {
    try {
      const reply = JSON.parse(line) as { id?: number; result?: { isError?: boolean } };
      if (reply.id === 2) return reply.result !== undefined && reply.result.isError !== true;
    } catch {
      // Not a whole JSON line (yet).
    }
  }
  return null;
}

const TOO_LONG = 'Setting up took too long, so it was stopped.';

function failed(message: string): RpcError {
  return new RpcError(ErrorCode.tool_failed, message);
}

export function connectAiTool(
  deps: ConnectDeps,
): (input: Record<string, unknown>) => Promise<Part[]> {
  return async (input) => {
    const { tool, token } = input;
    if (
      typeof tool !== 'string' ||
      !Object.hasOwn(LABELS, tool) ||
      typeof token !== 'string' ||
      !token
    ) {
      throw new RpcError(
        ErrorCode.invalid_params,
        'connect_ai_tool needs a known tool and a token',
      );
    }
    const known = tool as AiTool;
    const deadline = Date.now() + (deps.budgetMs ?? CONNECT_BUDGET_MS);

    // The handler cannot be aborted, so no command may run past the deadline: each gets what is
    // left, and a runner that never returns still ends the set-up before any file is written.
    async function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
      const left = deadline - Date.now();
      const timeoutMs = Math.min(opts.timeoutMs ?? left, left);
      if (timeoutMs <= 0) throw failed(TOO_LONG);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failed(TOO_LONG)), timeoutMs);
      });
      try {
        return await Promise.race([deps.run(command, args, { ...opts, timeoutMs }), expired]);
      } finally {
        clearTimeout(timer);
      }
    }

    async function writeLink(): Promise<void> {
      const path = join(deps.home(), 'memory-clients', `${known}.json`);
      const { addr, fingerprint } = deps.brain();
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, JSON.stringify({ addr, fingerprint, token }), {
          encoding: 'utf8',
          mode: 0o600,
        });
        if (deps.windows) {
          const result = await run('icacls', [
            path,
            '/inheritance:r',
            '/grant:r',
            `${deps.user}:F`,
          ]);
          if (result.code !== 0) throw new Error('icacls failed');
        }
      } catch {
        await rm(path, { force: true });
        throw failed('The pairing file could not be kept private, so nothing was set up.');
      }
    }

    async function addToCursor(): Promise<void> {
      const unreadable = failed(
        `Cursor's mcp.json (${deps.cursorConfig}) could not be read, so it was left as it is and nothing was set up.`,
      );
      let config: { mcpServers?: Record<string, unknown> } = {};
      try {
        const parsed: unknown = JSON.parse(await readFile(deps.cursorConfig, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw unreadable;
        config = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unreadable;
      }
      const [command, ...args] = bridge('cursor');
      config.mcpServers = { ...config.mcpServers, tagalong: { command, args } };
      await mkdir(dirname(deps.cursorConfig), { recursive: true });
      await writeFile(deps.cursorConfig, JSON.stringify(config, null, 2), 'utf8');
    }

    async function addWithCli(cli: (typeof CLI)[keyof typeof CLI]): Promise<void> {
      const scope = known === 'claude-code' ? ['--scope', 'user'] : [];
      const found = await run(deps.windows ? 'where' : 'which', [cli]);
      if (found.code !== 0) {
        throw failed(
          `${LABELS[known]} is not installed on this PC (no \`${cli}\` command), so nothing was set up.`,
        );
      }
      // Connecting again replaces the entry, so an old one is removed first (it may not exist).
      await run(cli, ['mcp', 'remove', 'tagalong', ...scope]);
      const added = await run(cli, ['mcp', 'add', ...scope, 'tagalong', '--', ...bridge(known)]);
      if (added.code !== 0) {
        const why = (added.stderr || added.stdout).trim().slice(0, 300);
        throw failed(
          `${LABELS[known]} would not add Scout's memory: ${why || `exit ${added.code}`}`,
        );
      }
    }

    // Added before the file is written, so a missing tool leaves nothing behind.
    if (known === 'cursor') await addToCursor();
    else await addWithCli(CLI[known]);
    await writeLink();

    let reached: boolean | null = null;
    try {
      const probe = await run(
        deps.tagalong.command,
        [...deps.tagalong.args, 'memory-mcp', '--client', known],
        { input: PROBE, until: '"id":2', timeoutMs: PROBE_LIMIT_MS },
      );
      reached = readReached(probe.stdout);
    } catch {
      // Out of time: the set-up itself is done, only the check is unanswered.
    }
    const label = LABELS[known];
    const text = reached
      ? `${label} is connected to Scout's memory: the bridge started and read the memory list.`
      : reached === false
        ? `${label} is set up, but the bridge could not reach Scout's brain. Check that the brain is running, then try again.`
        : `${label} is set up, but the bridge did not answer. If Tagalong was only just installed, open a new terminal window and try ${label} again.`;
    return [{ type: 'text', text }];
  };
}
