/** Tests for ConnectionsPanel: the brain's apps, Add an app, switch, Restart, Remove. */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppInfo, SetupOverview } from '../shapes';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const ADD_YOURSELF = "Can't find it? Add it yourself";

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

async function renderPanel(bridge: FakeHostBridge, tab: 'Apps' | 'Experts' = 'Apps') {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Connections' });
  if (tab === 'Experts') fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
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
    expect(row).toHaveTextContent('Runs on your PC');
    expect(row).toHaveTextContent('Connected');
    expect(row).toHaveTextContent('2 tools');
    expect(within(row).getByRole('switch', { name: 'Scout can use Files' })).toBeChecked();
  });

  it('says plainly when an app is not working, with the brain’s line', async () => {
    const bridge = createFakeHostBridge({ apps: [WIKI] });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Wiki' });
    expect(row).toHaveTextContent('Runs on the web');
    expect(row).toHaveTextContent('Not working');
    expect(screen.getByText('Could not reach wiki.example.')).toBeVisible();
  });

  const OAUTH: AppInfo = {
    ...WIKI,
    auth: 'oauth',
    status: 'needs-sign-in',
    error: '',
  };

  it('Sign in asks the brain to open the browser for an app that needs it', async () => {
    const bridge = createFakeHostBridge({ apps: [OAUTH] });
    await renderPanel(bridge);
    await click(screen.getByRole('button', { name: 'Sign in to Wiki' }));
    expect(bridge.signIns).toEqual(['wiki']);
  });

  it('says it is waiting for the browser while connecting an oauth app', async () => {
    const bridge = createFakeHostBridge({ apps: [{ ...OAUTH, status: 'connecting' }] });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Wiki' });
    expect(row).toHaveTextContent('Waiting for the browser');
    expect(within(row).queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('shows no Sign in for apps that do not use it', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES, WIKI] });
    await renderPanel(bridge);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('opens on the Apps tab: Your apps, then Add an app', async () => {
    await renderPanel(createFakeHostBridge());
    expect(
      screen.getByText(
        'Apps and experts Scout can use for you. Turn one off and Scout stops using it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Apps' })).toHaveAttribute('aria-selected', 'true');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Your apps', 'Add an app']);
  });

  it('Add it yourself opens the form, and the old summary is gone', async () => {
    await renderPanel(createFakeHostBridge());
    expect(screen.queryByLabelText('Address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(document.querySelector('summary')).toBeNull();
  });

  it('the form picks its kind with a segmented control, not radios, and the arrow keys move it', async () => {
    await renderPanel(createFakeHostBridge());
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    expect(document.querySelector('.cx-form input[type="radio"]')).toBeNull();
    const web = screen.getByRole('radio', { name: 'A web address' });
    expect(web).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(web, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'A command on this PC' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('Command')).toBeInTheDocument();
  });

  it('has no loops panel on Connections', async () => {
    await renderPanel(createFakeHostBridge());
    expect(screen.queryByText(/READ MY MAIL FOR LOOPS/i)).toBeNull();
  });

  it('offers sign-in at once after adding an app that signs in with its own page', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Signs in with'), { target: { value: 'oauth' } });
    await click(screen.getByRole('button', { name: 'Add app' }));
    expect(bridge.addedConnections[0]).toMatchObject({ auth: 'oauth' });
    expect(bridge.addedConnections[0]).not.toHaveProperty('token');
    expect(await screen.findByRole('button', { name: 'Sign in to Wiki' })).toBeInTheDocument();
  });

  it('notes that sign-in needs the brain and the browser on one machine', async () => {
    const bridge = createFakeHostBridge({ apps: [OAUTH] });
    await renderPanel(bridge);
    expect(screen.getByText(/same computer/i)).toBeInTheDocument();
  });

  it('adds a local command with its arguments and environment lines', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    fireEvent.click(screen.getByRole('radio', { name: 'A command on this PC' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Files' } });
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'npx -y @modelcontextprotocol/server-filesystem C:/notes' },
    });
    fireEvent.change(screen.getByLabelText(/Settings it needs/), {
      target: { value: 'API_KEY=${API_KEY}\n' },
    });
    await click(screen.getByRole('button', { name: 'Add app' }));
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
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'http://wiki.example' },
    });
    await click(screen.getByRole('button', { name: 'Add app' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use an address that starts with https://');
    expect(bridge.addedConnections).toEqual([]);
  });

  it('sends a pasted key once, then clears the field', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Signs in with'), { target: { value: 'token' } });
    const key = screen.getByLabelText('Key');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: 'sk-secret' } });
    await click(screen.getByRole('button', { name: 'Add app' }));
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

  it('turning a disabled app on sends the next value, and an off app shows Off', async () => {
    const bridge = createFakeHostBridge({ apps: [{ ...FILES, enabled: false, status: 'off' }] });
    await renderPanel(bridge);
    const toggle = screen.getByRole('switch', { name: 'Scout can use Files' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent('Off');
    await click(toggle);
    expect(bridge.enabledCalls).toEqual([{ id: 'files', enabled: true }]);
  });

  it('a long connection name truncates with its full text in title, and the actions stay', async () => {
    const name = 'A very long connection name '.repeat(8).trim();
    const bridge = createFakeHostBridge({ apps: [{ ...FILES, name }] });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name });
    expect(within(row).getByText(name)).toHaveAttribute('title', name);
    expect(within(row).getByRole('button', { name: `Restart ${name}` })).toBeVisible();
    expect(within(row).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  });

  it('says the status in words and shows Sign in as a primary button', async () => {
    const bridge = createFakeHostBridge({
      apps: [{ ...FILES, auth: 'oauth', status: 'needs-sign-in' }],
    });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Files' });
    expect(within(row).getByText('Needs sign-in')).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Sign in to Files' })).toHaveClass(
      'tg-button--primary',
    );
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
    expect(await screen.findByText(/brain isn’t running/i)).toBeVisible();
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
    expect(await screen.findByText(/brain isn’t running/i)).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: ADD_YOURSELF }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    await click(screen.getByRole('button', { name: 'Add app' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/^a stdio app needs a command\.$/);
  });

  it('says the list may be out of date when the brain drops with apps on screen', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    await renderPanel(bridge);
    bridge.listConnections = () => Promise.reject(new Error('brain offline'));
    await click(screen.getByRole('switch', { name: 'Scout can use Files' }));
    expect(await screen.findByText(/may be out of date/i)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
  });
});

function withSetup(setup: Partial<SetupOverview>) {
  return createFakeHostBridge({ apps: [FILES], setup });
}

describe('ConnectionsPanel groups', () => {
  it('shows the apps on the Apps tab and the experts on the Experts tab', async () => {
    const bridge = withSetup({
      experts: [
        {
          id: 'claude-acp',
          name: 'Claude Code',
          version: '2.0',
          state: 'ready',
          tested: true,
          official: true,
        },
      ],
    });
    await renderPanel(bridge);
    expect(screen.getByRole('region', { name: 'Your apps' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your experts' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
    expect(screen.getByRole('region', { name: 'Your experts' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your apps' })).toBeNull();
  });

  it('splits installed apps into Official and Community when the registry knows who made them', async () => {
    const bridge = createFakeHostBridge({
      apps: [FILES, { ...WIKI, id: 'com.notion/mcp', name: 'Notion' }],
      setup: {
        apps: [{ id: 'com.notion/mcp', name: 'Notion', state: 'connected', official: true }],
      },
    });
    await renderPanel(bridge);
    expect(
      within(screen.getByRole('list', { name: 'Official apps' })).getByText('Notion'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Community apps' })).getByText('Files'),
    ).toBeVisible();
    expect(
      screen.getByText('Made by other people. Scout asks before it changes anything with them.'),
    ).toBeVisible();
  });

  it('reads the overview again when the brain says setup changed', async () => {
    const bridge = withSetup({});
    await renderPanel(bridge, 'Experts');
    expect(screen.queryByRole('button', { name: 'Add Codex' })).toBeNull();
    bridge.setup = {
      ...bridge.setup,
      browseExperts: [
        {
          id: 'codex-acp',
          name: 'Codex',
          version: '1',
          description: 'An agent',
          official: true,
          recommended: false,
          tested: true,
          added: false,
          account: false,
          licence: '',
          repo: '',
        },
      ],
    };
    await act(async () => {
      bridge.emitChanged('setup');
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Add Codex' })).toBeInTheDocument();
  });

  it('keeps the offline note when the brain is away', async () => {
    const bridge = createFakeHostBridge({ listFails: 'brain offline' });
    await renderPanel(bridge, 'Experts');
    expect(await screen.findByText(/brain isn’t running/i)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Your experts' })).toBeNull();
  });

  it('keeps Your apps when the app list cannot be loaded', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES], overviewFails: 'no route' });
    await renderPanel(bridge);
    expect(await screen.findByText(/Scout couldn't load the app list/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
  });

  it('the Experts tab says the same plain line when the overview fails, not blank', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES], overviewFails: 'no route' });
    await renderPanel(bridge, 'Experts');
    expect(await screen.findByText(/Scout couldn't load the app list/)).toBeInTheDocument();
  });

  it('names the tab strip for Connections', async () => {
    await renderPanel(createFakeHostBridge({ apps: [FILES] }));
    expect(screen.getByRole('tablist', { name: 'Connections sections' })).toBeInTheDocument();
  });
});
