import { PluginId } from '@tagalong/protocol';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnChild, type SpawnFn } from './claude-code';

/** Where Claude Code keeps its plugins. */
export function claudePluginsRoot(): string {
  return join(homedir(), '.claude', 'plugins');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The plugins Claude Code has on this computer, read-only, by `name@marketplace`: the ones in
 * `installed_plugins.json`, plus those synced from claude.ai, which it names `name@synced`.
 * A catalog expert's run turns every one of them off except the ones it pins.
 */
export function installedPlugins(root: string = claudePluginsRoot()): string[] {
  const file = readJson(join(root, 'installed_plugins.json'));
  const installed =
    isRecord(file) && isRecord(file.plugins)
      ? Object.keys(file.plugins).filter((id) => PluginId.safeParse(id).success)
      : [];
  const synced: string[] = [];
  for (const group of list(join(root, 'synced'))) {
    for (const folder of list(join(root, 'synced', group))) {
      const manifest = readJson(
        join(root, 'synced', group, folder, '.claude-plugin', 'plugin.json'),
      );
      if (isRecord(manifest) && typeof manifest.name === 'string') {
        synced.push(`${manifest.name}@synced`);
      }
    }
  }
  return [...installed, ...synced];
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The apps the person set up in Claude Code, by the name it gives them: claude.ai connectors
 * they connected, and user-scope MCP servers. Read-only; Tagalong holds no sign-in for them.
 */
export function connectedApps(configPath: string = join(homedir(), '.claude.json')): string[] {
  const config = readJson(configPath);
  if (!isRecord(config)) return [];
  const claudeAi = Array.isArray(config.claudeAiMcpEverConnected)
    ? config.claudeAiMcpEverConnected.filter((name): name is string => typeof name === 'string')
    : [];
  const servers = isRecord(config.mcpServers) ? Object.keys(config.mcpServers) : [];
  return [...claudeAi, ...servers];
}

export type InstallResult = { ok: true } | { ok: false; error: string };

/**
 * Installs one plugin with Claude Code's own `claude plugin install <id>`. Only runs after
 * the person pressed Install on a card that names the plugin.
 */
export async function installPlugin(
  id: string,
  { spawn = spawnChild, command = 'claude' }: { spawn?: SpawnFn; command?: string } = {},
): Promise<InstallResult> {
  if (!PluginId.safeParse(id).success) {
    return { ok: false, error: `${id} is not a plugin id (name@marketplace).` };
  }
  let child;
  try {
    child = spawn(command, ['plugin', 'install', id], { cwd: tmpdir() });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { ok: false, error: 'Claude Code is not installed, or "claude" is not on the PATH.' };
    }
    return { ok: false, error: `Could not install ${id}: ${(error as Error).message}` };
  }
  child.end();
  for await (const line of child.lines) void line;
  const code = await child.exit;
  if (code === 0) return { ok: true };
  const said = child.stderr().trim();
  return { ok: false, error: `Could not install ${id}: ${said || `exit code ${code}`}` };
}

/**
 * Installs the plugins an entry pins that Claude Code does not have yet, one at a time,
 * stopping at the first that fails. `installed` lists the ones done before that.
 */
export async function installMissing(
  plugins: readonly string[],
  have: readonly string[],
  install: (id: string) => Promise<InstallResult>,
): Promise<{ ok: boolean; installed: string[]; error?: string }> {
  const installed: string[] = [];
  for (const id of plugins) {
    if (have.includes(id)) continue;
    const result = await install(id);
    if (!result.ok) return { ok: false, installed, error: result.error };
    installed.push(id);
  }
  return { ok: true, installed };
}
