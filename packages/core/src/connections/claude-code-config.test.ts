/** Tests for reading Claude Code's MCP servers: scopes, skipped transports and secrets kept out. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foundInClaudeCode, readClaudeCodeConnectors } from './claude-code-config';

describe('foundInClaudeCode', () => {
  it('reads user-scope and project-scope servers from ~/.claude.json', () => {
    const found = foundInClaudeCode({
      mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } },
      projects: {
        'C:/code/app': {
          mcpServers: { files: { command: 'npx', args: ['-y', 'some-server'] } },
        },
      },
    });
    expect(found).toEqual([
      {
        name: 'notion',
        transport: { type: 'http', url: 'https://mcp.notion.com/mcp' },
        scope: 'user',
        missingSecrets: [],
      },
      {
        name: 'files',
        transport: { type: 'stdio', command: 'npx', args: ['-y', 'some-server'], env: {} },
        scope: 'local',
        project: 'C:/code/app',
        missingSecrets: [],
      },
    ]);
  });

  it('keeps ${VAR} references and leaves every literal env value behind', () => {
    const [found] = foundInClaudeCode({
      mcpServers: {
        db: {
          type: 'stdio',
          command: 'db-server',
          env: { DB_URL: '${DB_URL}', API_KEY: 'sk-live-123', MODE: '${MODE:-prod}' },
        },
      },
    });
    expect(found?.transport).toEqual({
      type: 'stdio',
      command: 'db-server',
      args: [],
      env: { DB_URL: '${DB_URL}', MODE: '${MODE:-prod}' },
    });
    expect(found?.missingSecrets).toEqual(['API_KEY']);
    expect(JSON.stringify(found)).not.toContain('sk-live-123');
  });

  it('never copies a header value and names the header as missing', () => {
    const [found] = foundInClaudeCode({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: { Authorization: 'Bearer ghp_secret' },
        },
      },
    });
    expect(found?.missingSecrets).toEqual(['Authorization']);
    expect(JSON.stringify(found)).not.toContain('ghp_secret');
  });

  it('accepts streamable-http, skips transports it cannot speak and junk entries', () => {
    const found = foundInClaudeCode({
      mcpServers: {
        a: { type: 'streamable-http', url: 'https://a.example/mcp' },
        b: { type: 'sse', url: 'https://b.example/sse' },
        c: { type: 'ws', url: 'wss://c.example' },
        d: 'nonsense',
        e: { type: 'http', url: 'not a url' },
      },
    });
    expect(found.map((f) => f.name)).toEqual(['a']);
  });

  it('lists a server defined in two projects once', () => {
    const server = { command: 'x' };
    const found = foundInClaudeCode({
      projects: { '/p1': { mcpServers: { x: server } }, '/p2': { mcpServers: { x: server } } },
    });
    expect(found).toHaveLength(1);
  });

  it('answers nothing for a file that is not an object', () => {
    expect(foundInClaudeCode(null)).toEqual([]);
    expect(foundInClaudeCode([1, 2])).toEqual([]);
  });
});

describe('readClaudeCodeConnectors', () => {
  it('reads the file read-only and answers nothing when it is missing or broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    expect(readClaudeCodeConnectors(join(dir, 'missing.json'))).toEqual([]);
    writeFileSync(join(dir, 'broken.json'), '{not json');
    expect(readClaudeCodeConnectors(join(dir, 'broken.json'))).toEqual([]);
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ mcpServers: { x: { command: 'x' } } }));
    expect(readClaudeCodeConnectors(join(dir, 'ok.json'))).toHaveLength(1);
  });
});
