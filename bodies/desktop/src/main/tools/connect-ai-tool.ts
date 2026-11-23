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

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ConnectDeps {
  /** The brain's data folder (TAGALONG_HOME). */
  home: () => string;
  /** The address the bridge dials, and the fingerprint it pins (null for this PC's loopback). */
  brain: () => { addr: string; fingerprint: string | null };
  run: (command: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;
  /** How to start `tagalong`, for the one check that the bridge answers. */
  tagalong: { command: string; args: string[] };
  cursorConfig: string;
  windows: boolean;
  /** Who may read the pairing file on Windows. */
  user: string;
}

const LABELS = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor' } as const;
type AiTool = keyof typeof LABELS;
const CLI = { 'claude-code': 'claude', codex: 'codex' } as const;

// `cmd /c` because Windows tools cannot start the `.cmd` that puts `tagalong` on the path.
const bridge = (name: string): string[] => [
  'cmd',
  '/c',
  'tagalong',
  'memory-mcp',
  '--client',
  name,
];

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'tagalong', version: '1' },
  },
});

function failed(message: string): RpcError {
  return new RpcError(ErrorCode.tool_failed, message);
}

export function connectAiTool(
  deps: ConnectDeps,
): (input: Record<string, unknown>) => Promise<Part[]> {
  const { run } = deps;

  async function writeLink(name: string, token: string): Promise<void> {
    const path = join(deps.home(), 'memory-clients', `${name}.json`);
    const { addr, fingerprint } = deps.brain();
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, JSON.stringify({ addr, fingerprint, token }), {
        encoding: 'utf8',
        mode: 0o600,
      });
      if (deps.windows) {
        const result = await run('icacls', [path, '/inheritance:r', '/grant:r', `${deps.user}:F`]);
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
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unreadable;
      config = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unreadable;
    }
    const [command, ...args] = bridge('cursor');
    config.mcpServers = { ...config.mcpServers, tagalong: { command, args } };
    await mkdir(dirname(deps.cursorConfig), { recursive: true });
    await writeFile(deps.cursorConfig, JSON.stringify(config, null, 2), 'utf8');
  }

  async function addWithCli(tool: 'claude-code' | 'codex'): Promise<void> {
    const bin = CLI[tool];
    const scope = tool === 'claude-code' ? ['--scope', 'user'] : [];
    const found = await run(deps.windows ? 'where' : 'which', [bin]);
    if (found.code !== 0) {
      throw failed(
        `${LABELS[tool]} is not installed on this PC (no \`${bin}\` command), so nothing was set up.`,
      );
    }
    // Connecting again replaces the entry, so an old one is removed first (it may not exist).
    await run(bin, ['mcp', 'remove', 'tagalong', ...scope]);
    const added = await run(bin, ['mcp', 'add', ...scope, 'tagalong', '--', ...bridge(tool)]);
    if (added.code !== 0) {
      const why = (added.stderr || added.stdout).trim().slice(0, 300);
      throw failed(`${LABELS[tool]} would not add Scout's memory: ${why || `exit ${added.code}`}`);
    }
  }

  return async (input) => {
    const { tool, token } = input;
    if (typeof tool !== 'string' || !(tool in LABELS) || typeof token !== 'string' || !token) {
      throw new RpcError(
        ErrorCode.invalid_params,
        'connect_ai_tool needs a known tool and a token',
      );
    }
    const known = tool as AiTool;
    if (known === 'cursor') {
      await addToCursor();
      await writeLink(known, token);
    } else {
      // Checked and added before the file is written, so a missing tool leaves nothing behind.
      await addWithCli(known);
      await writeLink(known, token);
    }
    const probe = await run(
      deps.tagalong.command,
      [...deps.tagalong.args, 'memory-mcp', '--client', known],
      { input: `${INITIALIZE}\n` },
    );
    const label = LABELS[known];
    const text = probe.stdout.includes('"serverInfo"')
      ? `${label} is connected to Scout's memory: the bridge answered.`
      : `${label} is set up, but the bridge did not answer. If Tagalong was only just installed, open a new terminal window and try ${label} again.`;
    return [{ type: 'text', text }];
  };
}
