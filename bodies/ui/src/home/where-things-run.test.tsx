/**
 * Tests for WhereThingsRun: the brain's address with its link state, each connected app by
 * where it runs, Claude Code as a local process, and the refetch when the brain changes.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppInfo } from '@tagalong/protocol';
import { HostBridgeProvider, type BrainLink } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { WhereThingsRun } from './where-things-run';

const FILES: AppInfo = {
  id: 'files',
  name: 'Files',
  transport: 'stdio',
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [],
  command: 'node',
  args: ['files-server.js'],
};

const WIKI: AppInfo = {
  id: 'wiki',
  name: 'Wiki',
  transport: 'http',
  auth: 'none',
  enabled: true,
  status: 'error',
  error: 'Could not reach wiki.example.com.',
  tools: [],
  url: 'https://wiki.example.com/mcp',
};

const OFFLINE: BrainLink = { addr: 'ws://127.0.0.1:47321', status: 'offline' };

function renderCard(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <WhereThingsRun />
    </HostBridgeProvider>,
  );
}

const card = () => screen.findByRole('region', { name: 'Where things run' });

describe('WhereThingsRun', () => {
  it('shows the brain address and that it is connected', async () => {
    renderCard(createFakeHostBridge());
    const region = await card();
    expect(region).toHaveTextContent('ws://127.0.0.1:47321');
    expect(region).toHaveTextContent('Connected');
  });

  it('says Offline in words when the brain is down, with the address kept', async () => {
    renderCard(createFakeHostBridge({ brainLink: OFFLINE }));
    const region = await card();
    expect(region).toHaveTextContent('ws://127.0.0.1:47321');
    expect(region).toHaveTextContent('Offline');
  });

  it('shows a local app as its command and arguments, and a web app by its address', async () => {
    renderCard(createFakeHostBridge({ apps: [FILES, WIKI] }));
    const region = await card();
    await screen.findByText(/node files-server\.js/);
    expect(screen.getByText(/Files/).closest('p')).toHaveTextContent('Connected');
    expect(region).toHaveTextContent('Wiki');
    expect(region).toHaveTextContent('https://wiki.example.com/mcp');
    expect(region).toHaveTextContent('Not working');
  });

  it('names Claude Code as a local process the brain starts', async () => {
    renderCard(createFakeHostBridge());
    expect(await card()).toHaveTextContent(
      'Claude Code · runs on this machine, started by the brain',
    );
  });

  it('reads again when the brain says its link changed', async () => {
    const bridge = createFakeHostBridge();
    renderCard(bridge);
    const region = await card();
    expect(region).toHaveTextContent('Connected');
    bridge.brainLink = () => Promise.resolve(OFFLINE);
    act(() => bridge.emitChanged('link'));
    await screen.findByText('Offline');
  });

  it('reads again when the brain says its apps changed', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    renderCard(bridge);
    await screen.findByText(/node files-server\.js/);
    bridge.apps = [WIKI];
    act(() => bridge.emitChanged('apps'));
    expect(await screen.findByText(/https:\/\/wiki\.example\.com\/mcp/)).toBeInTheDocument();
  });

  it('reads again when connections change', async () => {
    const bridge = createFakeHostBridge({ apps: [] });
    renderCard(bridge);
    await card();
    bridge.apps = [FILES];
    act(() => bridge.emit({ type: 'connections.changed' }));
    expect(await screen.findByText(/node files-server\.js/)).toBeInTheDocument();
  });

  it('keeps a quiet note instead of apps while the brain is offline', async () => {
    renderCard(createFakeHostBridge({ brainLink: OFFLINE, apps: [FILES] }));
    const region = await card();
    expect(region).toHaveTextContent(/apps show up when the brain is connected/i);
    expect(region).not.toHaveTextContent('files-server.js');
  });

  it('hides the last app list while the brain is only connecting', async () => {
    const link: BrainLink = { addr: 'ws://127.0.0.1:47321', status: 'connecting' };
    renderCard(createFakeHostBridge({ brainLink: link, apps: [FILES] }));
    const region = await card();
    expect(region).toHaveTextContent(/apps show up when the brain is connected/i);
    expect(region).not.toHaveTextContent('files-server.js');
  });

  it('falls back to the command when the url is empty, and shows only the name if both are', async () => {
    const empty: AppInfo = { ...FILES, id: 'x', name: 'Odd', url: '', command: 'node', args: [] };
    const bare: AppInfo = { ...FILES, id: 'y', name: 'Bare', url: '', command: '', args: [] };
    renderCard(createFakeHostBridge({ apps: [empty, bare] }));
    await card();
    expect(await screen.findByText(/^Odd · node$/)).toBeInTheDocument();
    expect(screen.getByText('Bare')).toBeInTheDocument();
  });

  it('shows nothing on a host without a brain link', async () => {
    const bridge = createFakeHostBridge();
    delete bridge.brainLink;
    renderCard(bridge);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('region', { name: 'Where things run' })).toBeNull();
  });
});
