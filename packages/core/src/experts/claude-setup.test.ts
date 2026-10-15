import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChildRun, SpawnFn } from './claude-code';
import { connectedApps, installPlugin, installedPlugins } from './claude-setup';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tagalong-claude-setup-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('installedPlugins', () => {
  it('lists the plugins in installed_plugins.json, by name@marketplace', () => {
    writeFileSync(
      join(root, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'firecrawl@claude-plugins-official': [{ scope: 'user', version: '1.0.9' }],
          'notion@claude-plugins-official': [{ scope: 'user', version: '0.1.0' }],
        },
      }),
    );
    expect(installedPlugins(root)).toEqual([
      'firecrawl@claude-plugins-official',
      'notion@claude-plugins-official',
    ]);
  });

  it('adds plugins synced from claude.ai, which Claude Code names name@synced', () => {
    const plugin = join(root, 'synced', 'org_user', 'engineering~g2', '.claude-plugin');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'engineering' }));
    expect(installedPlugins(root)).toEqual(['engineering@synced']);
  });

  it('is empty when Claude Code has no plugins or the file is broken', () => {
    expect(installedPlugins(join(root, 'missing'))).toEqual([]);
    writeFileSync(join(root, 'installed_plugins.json'), '{not json');
    expect(installedPlugins(root)).toEqual([]);
  });
});

describe('connectedApps', () => {
  it("lists the person's claude.ai connectors and user-scope servers from ~/.claude.json", () => {
    const config = join(root, '.claude.json');
    writeFileSync(
      config,
      JSON.stringify({
        claudeAiMcpEverConnected: ['claude.ai Google Calendar', 'claude.ai Notion'],
        mcpServers: { github: { type: 'http', url: 'https://example.test' } },
      }),
    );
    expect(connectedApps(config)).toEqual([
      'claude.ai Google Calendar',
      'claude.ai Notion',
      'github',
    ]);
  });

  it('is empty when the file is missing', () => {
    expect(connectedApps(join(root, 'none.json'))).toEqual([]);
  });
});

interface Call {
  command: string;
  args: string[];
}

function fakeSpawn(exitCode: number, stderr = ''): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    const run: ChildRun = {
      write: () => undefined,
      end: () => undefined,
      lines: (async function* () {
        yield 'Installing plugin…';
      })(),
      exit: Promise.resolve(exitCode),
      stderr: () => stderr,
      kill: () => undefined,
    };
    return run;
  };
  return { spawn, calls };
}

describe('installPlugin', () => {
  it("runs Claude Code's own claude plugin install with the plugin id", async () => {
    const { spawn, calls } = fakeSpawn(0);
    await expect(installPlugin('firecrawl@claude-plugins-official', { spawn })).resolves.toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      { command: 'claude', args: ['plugin', 'install', 'firecrawl@claude-plugins-official'] },
    ]);
  });

  it('uses the command it was given', async () => {
    const { spawn, calls } = fakeSpawn(0);
    await installPlugin('notion@claude-plugins-official', { spawn, command: 'C:\\bin\\claude' });
    expect(calls[0]?.command).toBe('C:\\bin\\claude');
  });

  it('says in plain words why an install failed', async () => {
    const { spawn } = fakeSpawn(1, 'Plugin "nope" not found in marketplace\n');
    await expect(installPlugin('nope@claude-plugins-official', { spawn })).resolves.toEqual({
      ok: false,
      error: 'Could not install nope@claude-plugins-official: Plugin "nope" not found in marketplace',
    });
  });

  it('says so when claude is not installed', async () => {
    const spawn: SpawnFn = () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    };
    const result = await installPlugin('notion@claude-plugins-official', { spawn });
    expect(result).toEqual({
      ok: false,
      error: 'Claude Code is not installed, or "claude" is not on the PATH.',
    });
  });

  it('refuses an id that is not name@marketplace, without starting anything', async () => {
    const { spawn, calls } = fakeSpawn(0);
    const result = await installPlugin('--force', { spawn });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
