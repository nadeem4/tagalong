/**
 * Tests for the desktop tool that sets an AI tool up to use Scout's memory: a fake command
 * runner, a real temp folder for the pairing file and Cursor's mcp.json. Nothing real is run.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectAiTool, type RunOptions, type RunResult } from './connect-ai-tool';

const TOKEN = 'secret-token-value';
let dir: string;
let calls: { command: string; args: string[]; input?: string }[];
let answers: (command: string, args: string[]) => Partial<RunResult>;

function setup(windows = true) {
  const run = async (command: string, args: string[], opts?: RunOptions) => {
    calls.push({ command, args, ...(opts?.input === undefined ? {} : { input: opts.input }) });
    return { code: 0, stdout: '', stderr: '', ...answers(command, args) };
  };
  return connectAiTool({
    home: () => join(dir, 'home'),
    brain: () => ({ addr: '127.0.0.1:47321', fingerprint: null }),
    run,
    tagalong: { command: 'tagalong', args: [] },
    cursorConfig: join(dir, '.cursor', 'mcp.json'),
    windows,
    user: 'me',
  });
}

const readReply = (isError: boolean) =>
  `{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{}}}\n{"jsonrpc":"2.0","id":2,"result":{"content":[],"isError":${isError}}}\n`;
const bridgeAnswers = (command: string) =>
  command === 'tagalong' ? { stdout: readReply(false) } : {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connect-'));
  calls = [];
  answers = bridgeAnswers;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const linkFile = (name: string) => join(dir, 'home', 'memory-clients', `${name}.json`);

describe('connect_ai_tool', () => {
  it('stops inside its budget when a command never returns, and writes no pairing file', async () => {
    const connect = connectAiTool({
      home: () => join(dir, 'home'),
      brain: () => ({ addr: '127.0.0.1:47321', fingerprint: null }),
      run: () => new Promise(() => undefined),
      tagalong: { command: 'tagalong', args: [] },
      cursorConfig: join(dir, '.cursor', 'mcp.json'),
      windows: true,
      user: 'me',
      budgetMs: 100,
    });
    await expect(connect({ tool: 'codex', token: TOKEN })).rejects.toThrow(/too long/);
    expect(existsSync(linkFile('codex'))).toBe(false);
  });

  it('writes the pairing file and adds Claude Code at user scope', async () => {
    const out = await setup()({ tool: 'claude-code', token: TOKEN });
    expect(JSON.parse(readFileSync(linkFile('claude-code'), 'utf8'))).toEqual({
      addr: '127.0.0.1:47321',
      fingerprint: null,
      token: TOKEN,
    });
    const add = calls.find((c) => c.args.includes('add'));
    expect(add).toEqual({
      command: 'claude',
      args: [
        'mcp',
        'add',
        '--scope',
        'user',
        'tagalong',
        '--',
        'cmd',
        '/c',
        'tagalong',
        'memory-mcp',
        '--client',
        'claude-code',
      ],
    });
    expect(JSON.stringify(out)).toContain('read the memory list');
  });

  it('adds Codex with its own command', async () => {
    await setup()({ tool: 'codex', token: TOKEN });
    const add = calls.find((c) => c.command === 'codex' && c.args.includes('add'));
    expect(add?.args).toEqual([
      'mcp',
      'add',
      'tagalong',
      '--',
      'cmd',
      '/c',
      'tagalong',
      'memory-mcp',
      '--client',
      'codex',
    ]);
  });

  it('adds the entry to Cursor mcp.json, creating it and keeping other servers', async () => {
    await setup()({ tool: 'cursor', token: TOKEN });
    const file = join(dir, '.cursor', 'mcp.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.tagalong).toEqual({
      command: 'cmd',
      args: ['/c', 'tagalong', 'memory-mcp', '--client', 'cursor'],
    });
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    await setup()({ tool: 'cursor', token: TOKEN });
    const servers = JSON.parse(readFileSync(file, 'utf8')).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['other', 'tagalong']);
  });

  it('reports an unreadable Cursor file and leaves it and the pairing file alone', async () => {
    const file = join(dir, '.cursor', 'mcp.json');
    await setup()({ tool: 'cursor', token: TOKEN });
    writeFileSync(file, '{ not json');
    rmSync(linkFile('cursor'));
    await expect(setup()({ tool: 'cursor', token: TOKEN })).rejects.toThrow(/mcp\.json/);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
    expect(existsSync(linkFile('cursor'))).toBe(false);
  });

  it('reports a failed command in its own words', async () => {
    answers = (command, args) =>
      args.includes('add') ? { code: 1, stderr: 'boom' } : bridgeAnswers(command);
    const error = await setup()({ tool: 'claude-code', token: TOKEN }).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/boom/);
  });

  it('refuses before writing anything when the tool is not installed', async () => {
    answers = (command) => (command === 'where' ? { code: 1 } : {});
    await expect(setup()({ tool: 'codex', token: TOKEN })).rejects.toThrow(/not installed/);
    expect(existsSync(linkFile('codex'))).toBe(false);
  });

  it('says so when the bridge does not answer, without the token', async () => {
    answers = () => ({});
    const out = JSON.stringify(await setup()({ tool: 'codex', token: TOKEN }));
    expect(out).toContain('did not answer');
    expect(out).not.toContain(TOKEN);
  });

  it('says so when the bridge starts but cannot reach the brain', async () => {
    answers = (command) => (command === 'tagalong' ? { stdout: readReply(true) } : {});
    const out = JSON.stringify(await setup()({ tool: 'codex', token: TOKEN }));
    expect(out).toContain("could not reach Scout's brain");
  });

  it('does not call a JSON-RPC error reply a success', async () => {
    answers = (command) =>
      command === 'tagalong'
        ? { stdout: '{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"x"}}\n' }
        : {};
    const out = JSON.stringify(await setup()({ tool: 'codex', token: TOKEN }));
    expect(out).toContain("could not reach Scout's brain");
  });

  it('sends the bridge a real read, not only the greeting', async () => {
    await setup()({ tool: 'codex', token: TOKEN });
    const probe = calls.find((c) => c.command === 'tagalong');
    expect(probe?.input).toContain('"method":"tools/call"');
    expect(probe?.input).toContain('list_memories');
  });

  it('refuses a tool name that only exists on Object.prototype', async () => {
    await expect(setup()({ tool: 'constructor', token: TOKEN })).rejects.toThrow(/known tool/);
  });

  it('restricts the pairing file to the owner on Windows', async () => {
    await setup()({ tool: 'codex', token: TOKEN });
    expect(calls.find((c) => c.command === 'icacls')?.args).toEqual([
      linkFile('codex'),
      '/inheritance:r',
      '/grant:r',
      'me:F',
    ]);
  });

  it('removes the pairing file when it cannot be restricted', async () => {
    answers = (command) => (command === 'icacls' ? { code: 1 } : bridgeAnswers(command));
    await expect(setup()({ tool: 'codex', token: TOKEN })).rejects.toThrow();
    expect(existsSync(linkFile('codex'))).toBe(false);
  });

  it('refuses an unknown tool', async () => {
    await expect(setup()({ tool: '../notepad', token: TOKEN })).rejects.toThrow();
  });
});
