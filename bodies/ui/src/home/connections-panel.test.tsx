/** Tests for ConnectionsPanel: the brain's apps, Add an app, switch, Restart, Remove. */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppInfo } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const FILES: AppInfo = {
  id: 'files',
  name: 'Files',
  transport: 'stdio',
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [
    { name: 'files__read', effect: 'look', locked: false },
    { name: 'files__write', effect: 'change', locked: false },
  ],
};

const WIKI: AppInfo = {
  id: 'wiki',
  name: 'Wiki',
  transport: 'http',
  auth: 'token',
  enabled: true,
  status: 'error',
  error: 'Could not reach wiki.example.',
  tools: [],
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
  it('lists each app with its transport, status text, tool count and switch', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Files' });
    expect(row).toHaveTextContent('Runs on this PC');
    expect(row).toHaveTextContent('Connected');
    expect(row).toHaveTextContent('2 tools');
    expect(within(row).getByRole('switch', { name: 'Scout can use Files' })).toBeChecked();
  });

  it('says plainly when an app is not working, with the brain’s line', async () => {
    const bridge = createFakeHostBridge({ apps: [WIKI] });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Wiki' });
    expect(row).toHaveTextContent('Web address');
    expect(row).toHaveTextContent('Not working');
    expect(row).toHaveTextContent('Could not reach wiki.example.');
  });

  it('offers no sign-in button yet, even for an oauth app that needs it', async () => {
    const bridge = createFakeHostBridge({
      apps: [{ ...WIKI, auth: 'oauth', status: 'needs-sign-in', error: 'Sign in again.' }],
    });
    await renderPanel(bridge);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('adds a local command with its arguments and environment lines', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add an app'));
    fireEvent.click(screen.getByLabelText('A command on this PC'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Files' } });
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'npx -y @modelcontextprotocol/server-filesystem C:/notes' },
    });
    fireEvent.change(screen.getByLabelText(/Environment/), {
      target: { value: 'API_KEY=${API_KEY}\n' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(bridge.addedConnections).toEqual([
      {
        name: 'Files',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/notes'],
        env: { API_KEY: '${API_KEY}' },
        auth: 'none',
      },
    ]);
    // The brain's answer is read again: the new app shows up.
    expect(await screen.findByRole('region', { name: 'Files' })).toBeInTheDocument();
  });

  it('refuses a web address that is not https', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add an app'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'http://wiki.example' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use an address that starts with https://');
    expect(bridge.addedConnections).toEqual([]);
  });

  it('sends a pasted key once, then clears the field', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add an app'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Signs in with'), { target: { value: 'token' } });
    const key = screen.getByLabelText('Key');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: 'sk-secret' } });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(bridge.addedConnections).toEqual([
      {
        name: 'Wiki',
        transport: 'http',
        url: 'https://wiki.example/mcp',
        auth: 'token',
        token: 'sk-secret',
      },
    ]);
    expect(screen.getByLabelText('Key')).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-secret')).toBeNull();
  });

  it('turns an app on or off with its switch', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    await click(screen.getByRole('switch', { name: 'Scout can use Files' }));
    expect(bridge.enabledCalls).toEqual([{ id: 'files', enabled: false }]);
    expect(screen.getByRole('switch', { name: 'Scout can use Files' })).not.toBeChecked();
  });

  it('Restart asks the brain to restart that app', async () => {
    const bridge = createFakeHostBridge({ apps: [WIKI] });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Restart Wiki' }));
    expect(bridge.restarts).toEqual(['wiki']);
  });

  it('Remove asks once more, in the page, before removing', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Remove Files' }));
    expect(bridge.removedConnections).toEqual([]);
    await click(screen.getByRole('button', { name: 'Yes, remove Files' }));
    expect(bridge.removedConnections).toEqual(['files']);
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
  });

  it('Keep backs out of a Remove', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Remove Files' }));
    await click(screen.getByRole('button', { name: 'Keep Files' }));
    expect(bridge.removedConnections).toEqual([]);
    expect(screen.getByRole('button', { name: 'Remove Files' })).toBeInTheDocument();
  });

  it('reads the list again when connections change', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    bridge.apps = [{ ...FILES, status: 'error', error: 'It stopped.' }];
    await act(async () => {
      bridge.emit({ type: 'connections.changed' });
      await Promise.resolve();
    });
    expect(await screen.findByText('It stopped.')).toBeInTheDocument();
  });

  it('says the brain is offline instead of an empty page', async () => {
    const bridge = createFakeHostBridge({ listFails: 'brain offline' });
    render(
      <HostBridgeProvider bridge={bridge}>
        <ConnectionsPanel />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/brain isn’t running/i);
    expect(screen.queryByRole('heading', { name: 'Connections' })).not.toBeNull();
  });

  it('reads the offline error through Electron’s wrapper, with one note and no alert', async () => {
    const bridge = createFakeHostBridge({
      listFails: "Error invoking remote method 'tagalong:connections:list': Error: brain offline",
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <ConnectionsPanel />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/brain isn’t running/i);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a brain refusal as its own plain line, without Electron’s wrapper', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    bridge.addConnection = () =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'tagalong:connections:add': Error: a stdio app needs a command.",
        ),
      );
    await renderPanel(bridge);
    fireEvent.click(screen.getByText('Add an app'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    await click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/^a stdio app needs a command\.$/);
  });

  it('says the list may be out of date when the brain drops with apps on screen', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    bridge.listConnections = () => Promise.reject(new Error('brain offline'));
    await click(screen.getByRole('switch', { name: 'Scout can use Files' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/may be out of date/i);
    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
  });
});
