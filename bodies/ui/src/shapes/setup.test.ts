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

describe('parseSetupOverview', () => {
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
});
