/** Tests for ConnectionsPanel: Popular, Claude Code servers, Add a connector, Disconnect. */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, FoundConnector, PopularConnector } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const POPULAR: PopularConnector[] = [
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    blurb: 'Search and read your pages.',
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    blurb: 'Pull requests and reviews.',
    tokenHint: 'Paste a GitHub personal access token.',
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
  },
];

const LINEAR: ConnectionState = {
  id: 'linear',
  name: 'Linear',
  transport: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  auth: 'oauth',
  secretNames: [],
  enabled: true,
  status: 'connected',
  tools: [
    { name: 'list_issues', description: 'List issues.', access: 'read' },
    { name: 'create_issue', description: 'Create an issue.', access: 'write' },
  ],
};

async function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Connections' });
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
};

describe('ConnectionsPanel', () => {
  it('connects a popular app that signs in with one click', async () => {
    const bridge = createFakeHostBridge({ connections: { popular: POPULAR } });
    await renderPanel(bridge);
    const popular = screen.getByRole('list', { name: 'Popular' });
    await click(within(popular).getByRole('button', { name: 'Connect Notion' }));
    expect(bridge.addedConnections).toEqual([
      {
        id: 'notion',
        name: 'Notion',
        transport: { type: 'http', url: 'https://mcp.notion.com/mcp' },
        auth: 'oauth',
      },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Finish signing in to Notion in your browser.',
    );
  });

  it('asks for a key for an app that takes one, and sends it only to be stored', async () => {
    const bridge = createFakeHostBridge({ connections: { popular: POPULAR } });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(screen.getByText('Paste a GitHub personal access token.')).toBeInTheDocument();
    const key = screen.getByLabelText('Key for GitHub');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: 'ghp_abc' } });
    await click(screen.getByRole('button', { name: 'Connect' }));
    expect(bridge.addedConnections[0]).toMatchObject({
      id: 'github',
      auth: 'token',
      secrets: { token: 'ghp_abc' },
    });
  });

  it('hides a popular app already connected', async () => {
    const bridge = createFakeHostBridge({
      connections: { popular: POPULAR, connections: [{ ...LINEAR, id: 'notion', name: 'Notion' }] },
    });
    await renderPanel(bridge);
    expect(screen.queryByRole('button', { name: 'Connect Notion' })).toBeNull();
  });

  it('shows each connection with its status, its tools as reads or changes, and a switch', async () => {
    const bridge = createFakeHostBridge({ connections: { connections: [LINEAR] } });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Linear' });
    expect(row).toHaveTextContent('Connected');
    expect(row).toHaveTextContent('2 tools');
    fireEvent.click(within(row).getByText('Tools'));
    expect(within(row).getByText('list_issues').closest('li')).toHaveTextContent('Reads');
    expect(within(row).getByText('create_issue').closest('li')).toHaveTextContent('Asks first');
    await click(within(row).getByRole('switch', { name: 'Scout can use Linear' }));
    expect(bridge.connections.connections[0]?.enabled).toBe(false);
  });

  it('offers Sign in again when an app needs it, and says why it failed in plain words', async () => {
    const bridge = createFakeHostBridge({
      connections: {
        connections: [
          {
            ...LINEAR,
            status: 'needs-sign-in',
            tools: [],
            error: 'Linear wants you to sign in again.',
          },
        ],
      },
    });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Linear' });
    expect(row).toHaveTextContent('Linear wants you to sign in again.');
    await click(within(row).getByRole('button', { name: 'Sign in again' }));
    expect(bridge.signIns).toEqual(['linear']);
  });

  it('Disconnect asks once more, then removes it with its tokens', async () => {
    const bridge = createFakeHostBridge({ connections: { connections: [LINEAR] } });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Disconnect' }));
    await click(screen.getByRole('button', { name: 'Disconnect Linear and delete its sign-in' }));
    expect(bridge.removedConnections).toEqual(['linear']);
    expect(screen.queryByRole('region', { name: 'Linear' })).toBeNull();
  });

  it('reuses a server found in Claude Code, asking for any secret it did not copy', async () => {
    const found: FoundConnector[] = [
      {
        name: 'wiki',
        transport: { type: 'http', url: 'https://wiki.example/mcp' },
        scope: 'user',
        missingSecrets: [],
      },
      {
        name: 'db',
        transport: { type: 'stdio', command: 'db-server', args: [], env: {} },
        scope: 'local',
        project: 'C:/code/app',
        missingSecrets: ['API_KEY'],
      },
    ];
    const bridge = createFakeHostBridge({ connections: { found } });
    await renderPanel(bridge);
    const list = screen.getByRole('list', { name: 'Found on this PC' });
    expect(list).toHaveTextContent('From Claude Code');
    await click(within(list).getByRole('button', { name: 'Use wiki' }));
    expect(bridge.addedConnections[0]).toEqual({
      name: 'wiki',
      transport: { type: 'http', url: 'https://wiki.example/mcp' },
      auth: 'oauth',
    });
    await click(within(list).getByRole('button', { name: 'Use db' }));
    fireEvent.change(screen.getByLabelText('API_KEY for db'), { target: { value: 'sk-1' } });
    await click(within(list).getByRole('button', { name: 'Connect' }));
    expect(bridge.addedConnections[1]).toEqual({
      name: 'db',
      transport: { type: 'stdio', command: 'db-server', args: [], env: {} },
      auth: 'none',
      secrets: { API_KEY: 'sk-1' },
    });
  });

  it('adds a local command under Advanced', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add a connector'));
    fireEvent.click(screen.getByLabelText('A command on this PC'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Files' } });
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'npx -y @modelcontextprotocol/server-filesystem C:/notes' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(bridge.addedConnections[0]).toEqual({
      name: 'Files',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/notes'],
        env: {},
      },
      auth: 'none',
    });
  });

  it('adds a remote URL under Advanced, refusing one that is not https', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add a connector'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'http://wiki.example' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use an address that starts with https://');
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(bridge.addedConnections[0]).toMatchObject({ name: 'Wiki', auth: 'oauth' });
  });

  it('updates live when a connection changes', async () => {
    const bridge = createFakeHostBridge({ connections: { connections: [LINEAR] } });
    await renderPanel(bridge);
    act(() =>
      bridge.emit({
        type: 'connections.changed',
        connections: [
          { ...LINEAR, status: 'error', tools: [], error: 'Could not connect to Linear.' },
        ],
      }),
    );
    expect(screen.getByRole('region', { name: 'Linear' })).toHaveTextContent(
      'Could not connect to Linear.',
    );
  });
});
