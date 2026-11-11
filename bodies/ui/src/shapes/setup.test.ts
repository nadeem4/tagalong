/** Tests for the setup overview shape: the brain's JSON becomes the page's camelCase view. */
import { describe, expect, it } from 'vitest';
import { parseSetupOverview } from './setup';

const WIRE = {
  experts: [{ id: 'claude-acp', name: 'Claude Code', version: '2', state: 'ready', tested: true }],
  apps: [{ id: 'a', name: 'Notes', state: 'connected' }],
  browse_experts: [{ id: 'codex-acp', name: 'Codex', version: '1', description: 'd' }],
  browse_apps: [{ id: 'x/y', name: 'y', version: '1', description: 'd' }],
  stale: false,
  progress: { expert: 'claude-acp', stage: 'node', percent: 40 },
  failed: null,
};

const ROW = {
  id: 'com.notion/mcp',
  name: 'Notion',
  version: '1',
  description: 'd',
  official: true,
  publisher: 'notion.com',
  runs: 'hosted',
  host: 'mcp.notion.com',
  sign_in: 'browser',
  licence: 'MIT',
  repo: 'https://github.com/x/y',
};

describe('parseSetupOverview', () => {
  it('maps popular, app_groups (sign_in) and next_cursor to camelCase', () => {
    const overview = parseSetupOverview({
      ...WIRE,
      popular: [ROW],
      app_groups: [
        { service: 'notion', official: ROW, others: [{ ...ROW, official: false, why: 'w' }] },
      ],
      next_cursor: 'c2',
      sources: {
        apps: { name: 'MCP registry', url: 'https://r/mcp' },
        experts: { name: 'ACP registry', url: 'https://r/acp' },
      },
    });
    expect(overview.popular[0]?.signIn).toBe('browser');
    expect(overview.appGroups[0]?.official?.id).toBe('com.notion/mcp');
    expect(overview.appGroups[0]?.others[0]?.why).toBe('w');
    expect(overview.nextCursor).toBe('c2');
    expect(overview.sources?.apps.url).toBe('https://r/mcp');
  });

  it('an old shape without the new fields still parses', () => {
    const overview = parseSetupOverview(WIRE);
    expect(overview.popular).toEqual([]);
    expect(overview.appGroups).toEqual([]);
    expect(overview.nextCursor).toBeNull();
    expect(overview.sources).toBeNull();
  });

  it('official defaults false on a browse_experts row', () => {
    expect(parseSetupOverview(WIRE).browseExperts[0]?.official).toBe(false);
  });

  it('maps the brain JSON to the camelCase overview', () => {
    const overview = parseSetupOverview(WIRE);
    expect(overview.browseExperts[0]?.id).toBe('codex-acp');
    expect(overview.browseApps[0]?.id).toBe('x/y');
    expect(overview.progress).toEqual({ expert: 'claude-acp', stage: 'node', percent: 40 });
    expect(overview.failed).toBeNull();
  });

  it('refuses an odd state', () => {
    const odd = { ...WIRE, experts: [{ ...WIRE.experts[0], state: 'weird' }] };
    expect(() => parseSetupOverview(odd)).toThrow();
  });

  it('reads popular_more, official on installed apps and the curated expert fields', () => {
    const overview = parseSetupOverview({
      ...WIRE,
      apps: [{ id: 'a', name: 'Notes', state: 'connected', official: true }],
      popular_more: [ROW],
      browse_experts: [
        {
          id: 'claude-acp',
          name: 'Claude Code',
          version: '1',
          description: 'd',
          official: true,
          recommended: true,
          tested: true,
        },
      ],
      show_more_from: 1,
    });
    expect(overview.apps[0]?.official).toBe(true);
    expect(overview.popularMore[0]?.id).toBe('com.notion/mcp');
    expect(overview.browseExperts[0]).toMatchObject({ recommended: true, tested: true });
    expect(overview.showMoreFrom).toBe(1);
  });

  it('an old brain without them parses: apps not official, nothing hidden behind Show more', () => {
    const overview = parseSetupOverview(WIRE);
    expect(overview.apps[0]?.official).toBe(false);
    expect(overview.popularMore).toEqual([]);
    expect(overview.browseExperts[0]).toMatchObject({ recommended: false, tested: false });
    expect(overview.showMoreFrom).toBeNull();
  });
});
