/**
 * Reads the MCP servers the person set up in Claude Code (~/.claude.json), read-only and
 * without secrets, for Home's "Found on this PC" list. Contains readClaudeCodeConnectors,
 * foundInClaudeCode and claudeCodeConfigPath.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConnectionTransport, type FoundConnector } from '@tagalong/protocol';
import { isEnvReference } from './access';

/**
 * Claude Code keeps user-scope MCP servers under `mcpServers` in `~/.claude.json`, and
 * local-scope ones under `projects[<path>].mcpServers` in the same file
 * (https://code.claude.com/docs/en/mcp, "MCP installation scopes"). Project-scope
 * `.mcp.json` files sit in each repository and are not read.
 */
export function claudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * One server, without its secrets: a `${VAR}` reference is copied, a literal env value or
 * any header is left behind and named in `missingSecrets`. Transports Tagalong cannot
 * speak (SSE, WebSocket, SDK) and malformed entries are skipped.
 */
function toFound(
  name: string,
  raw: unknown,
  scope: FoundConnector['scope'],
  project?: string,
): FoundConnector | null {
  if (!isObject(raw)) return null;
  const type = raw['type'] ?? (raw['command'] !== undefined ? 'stdio' : undefined);
  let candidate: unknown;
  const missingSecrets: string[] = [];
  if (type === 'http' || type === 'streamable-http') {
    candidate = { type: 'http', url: raw['url'] };
    missingSecrets.push(...Object.keys(strings(raw['headers'])));
  } else if (type === 'stdio') {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(strings(raw['env']))) {
      if (isEnvReference(value)) env[key] = value;
      else missingSecrets.push(key);
    }
    const args = Array.isArray(raw['args'])
      ? raw['args'].filter((a): a is string => typeof a === 'string')
      : [];
    candidate = { type: 'stdio', command: raw['command'], args, env };
  } else {
    return null;
  }
  const transport = ConnectionTransport.safeParse(candidate);
  if (!transport.success) return null;
  return {
    name,
    transport: transport.data,
    scope,
    ...(project !== undefined ? { project } : {}),
    missingSecrets,
  };
}

/** Every server in a parsed `~/.claude.json`, user scope first, each name once. */
export function foundInClaudeCode(config: unknown): FoundConnector[] {
  if (!isObject(config)) return [];
  const found: FoundConnector[] = [];
  const add = (entry: FoundConnector | null) => {
    if (entry !== null && !found.some((f) => f.name === entry.name)) found.push(entry);
  };
  const user = config['mcpServers'];
  if (isObject(user))
    for (const [name, raw] of Object.entries(user)) add(toFound(name, raw, 'user'));
  const projects = config['projects'];
  if (isObject(projects)) {
    for (const [path, entry] of Object.entries(projects)) {
      const servers = isObject(entry) ? entry['mcpServers'] : undefined;
      if (!isObject(servers)) continue;
      for (const [name, raw] of Object.entries(servers)) add(toFound(name, raw, 'local', path));
    }
  }
  return found;
}

/** Reads the file read-only. Missing or unreadable: nothing found, never an error. */
export function readClaudeCodeConnectors(path: string = claudeCodeConfigPath()): FoundConnector[] {
  try {
    return foundInClaudeCode(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
}
