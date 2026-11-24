/** Tests for the Runs on control on Connections rows: one per row, none on a one-machine setup, and a choice sets the placement. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, type BrainCard } from '../host-bridge';
import type { AppInfo, SetupExpert } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const app = (id: string, name: string, over: Partial<AppInfo> = {}): AppInfo => ({
  id,
  name,
  transport: 'stdio',
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [],
  ...over,
});

const REMOTE: BrainCard = {
  status: 'running',
  update: 'none',
  version: '0.9.2',
  build: 'a1b2c3d',
  model: 'Claude Opus 5.5',
  appVersion: '0.9.2',
  appBuild: 'a1b2c3d',
  startedAt: null,
  startedBy: null,
  addr: '192.168.1.20:47321',
  pid: null,
  dataDir: '',
  logPath: '',
  places: [],
  workRunning: false,
  host: 'mini-pc',
  local: false,
};

const CLAUDE: SetupExpert = {
  id: 'claude-acp',
  name: 'Claude Code',
  version: '2.0',
  state: 'ready',
  tested: true,
  official: true,
};

function open(options: Parameters<typeof createFakeHostBridge>[0] = {}) {
  const bridge = createFakeHostBridge({
    apps: [app('files', 'Files'), app('gmail', 'Gmail')],
    setup: { experts: [CLAUDE] },
    ...options,
  });
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  return bridge;
}

describe('Runs on on Connections rows', () => {
  it('shows nothing on a one-machine setup', async () => {
    open();
    await screen.findByRole('region', { name: 'Files' });
    expect(screen.queryByRole('button', { name: /^Runs on/ })).not.toBeInTheDocument();
  });

  it('gives each app and each expert one control, naming the brain machine', async () => {
    open({ brainCard: REMOTE });
    const files = await screen.findByRole('region', { name: 'Files' });
    await within(files).findByRole('button', { name: 'Runs on, Files: mini-pc' });
    expect(screen.getAllByRole('button', { name: /^Runs on, / })).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
    const claude = await screen.findByRole('region', { name: 'Claude Code' });
    expect(within(claude).getAllByRole('button', { name: /^Runs on, Claude Code/ })).toHaveLength(
      1,
    );
  });

  it('sets the placement to this PC when it is chosen, and the row then says so', async () => {
    const bridge = open({ brainCard: REMOTE });
    const files = await screen.findByRole('region', { name: 'Files' });
    fireEvent.click(await within(files).findByRole('button', { name: 'Runs on, Files: mini-pc' }));
    fireEvent.click(screen.getByRole('button', { name: /^This PC/ }));
    await waitFor(() => expect(bridge.placementCalls).toEqual(['app:files body']));
    await within(files).findByRole('button', { name: 'Runs on, Files: This PC' });
  });

  it('says what a row waits on when its place is not connected', async () => {
    open({
      brainCard: REMOTE,
      apps: [
        app('gmail', 'Gmail', {
          status: 'error',
          error: 'Gmail runs on this-pc, which is not connected right now.',
          waiting_on: 'node-this',
        }),
      ],
      placements: {
        thisPc: 'node-this',
        places: { 'app:gmail': { mode: 'body', bodyId: 'node-this', prefer: null } },
      },
    });
    const row = await screen.findByRole('region', { name: 'Gmail' });
    expect(row).toHaveTextContent('Waiting for This PC');
  });
});
