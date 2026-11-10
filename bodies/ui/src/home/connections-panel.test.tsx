/** Tests for ConnectionsPanel: the brain's apps, Add an app, switch, Restart, Remove. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppGroup, AppInfo, AppRow, SetupOverview, SetupResult } from '../shapes';
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

  it('opens on the Apps tab: Connected, then Add an app', async () => {
    await renderPanel(createFakeHostBridge());
    expect(
      screen.getByText('The apps Scout can use for you. Turn one off to stop Scout using it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Apps' })).toHaveAttribute('aria-selected', 'true');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['CONNECTED', 'ADD AN APP']);
  });

  it('Add one by hand opens the form, and the old summary is gone', async () => {
    await renderPanel(createFakeHostBridge());
    expect(screen.queryByLabelText('Address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(document.querySelector('summary')).toBeNull();
  });

  it('has no loops panel on Connections', async () => {
    await renderPanel(createFakeHostBridge());
    expect(screen.queryByText(/READ MY MAIL FOR LOOPS/i)).toBeNull();
  });

  it('offers sign-in at once after adding an app that signs in with its own page', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wiki' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://wiki.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Signs in with'), { target: { value: 'oauth' } });
    await click(screen.getByRole('button', { name: 'Add' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
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

  it('shows the status as a chip and Sign in as a primary button', async () => {
    const bridge = createFakeHostBridge({
      apps: [{ ...FILES, auth: 'oauth', status: 'needs-sign-in' }],
    });
    await renderPanel(bridge);
    const row = screen.getByRole('region', { name: 'Files' });
    expect(within(row).getByText('Needs sign-in').closest('.tg-chip')).toHaveClass('tg-chip--warn');
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
    fireEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
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

const CLAUDE = {
  id: 'claude-acp',
  name: 'Claude Code',
  version: '2.0',
  tested: true,
  official: true,
};
const CODEX = {
  id: 'codex-acp',
  name: 'Codex',
  version: '1.0',
  description: 'OpenAI’s agent',
  official: true,
};

function withSetup(setup: Partial<SetupOverview>, setupResult?: SetupResult) {
  return createFakeHostBridge({ apps: [FILES], setup, ...(setupResult && { setupResult }) });
}

describe('ConnectionsPanel groups', () => {
  it('shows the apps on the Apps tab and the experts on the Experts tab', async () => {
    await renderPanel(withSetup({ experts: [{ ...CLAUDE, state: 'ready' }] }));
    expect(screen.getByRole('region', { name: 'Connected apps' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'For long jobs' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
    expect(screen.getByRole('region', { name: 'For long jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Connected apps' })).toBeNull();
  });

  it('an expert row leads with the kind of job and keeps the product underneath', async () => {
    await renderPanel(
      withSetup({
        experts: [
          { ...CLAUDE, state: 'ready' },
          { ...CLAUDE, id: 'other', name: 'Beta', state: 'ready' },
        ],
      }),
      'Experts',
    );
    const claude = screen.getByRole('region', { name: 'Claude Code' });
    expect(within(claude).getByText('Fix code and other long jobs')).toBeVisible();
    expect(within(claude).getByText('Claude Code · Version 2.0')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Beta' })).getByText('Long, many-step jobs'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'FOR LONG JOBS' })).toBeVisible();
  });

  it('each expert row shows its state and the action that fits it', async () => {
    await renderPanel(
      withSetup({
        experts: [
          { ...CLAUDE, state: 'needs_login' },
          { ...CLAUDE, id: 'b', name: 'Beta', state: 'needs_update' },
          { ...CLAUDE, id: 'c', name: 'Gamma', state: 'ready' },
        ],
      }),
      'Experts',
    );
    const row = (name: string) => screen.getByRole('region', { name });
    expect(within(row('Claude Code')).getByText('Needs login')).toBeInTheDocument();
    expect(within(row('Claude Code')).getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(within(row('Beta')).getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(within(row('Gamma')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Gamma')).queryByRole('button')).toBeNull();
  });

  it('an untested expert is marked untested', async () => {
    await renderPanel(
      withSetup({
        experts: [
          { ...CLAUDE, state: 'ready' },
          { ...CLAUDE, id: 'x', name: 'Xtra', tested: false, state: 'ready' },
        ],
      }),
      'Experts',
    );
    expect(
      within(screen.getByRole('region', { name: 'Xtra' })).getByText('Untested'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Claude Code' })).queryByText('Untested'),
    ).toBeNull();
  });

  it('Add on a browse expert calls setupExpert with approved false', async () => {
    const bridge = withSetup({ browseExperts: [CODEX] });
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'codex-acp', approved: false }]);
  });

  it('Set up on an expert row asks with approved false too', async () => {
    const bridge = withSetup({ experts: [{ ...CLAUDE, state: 'needs_login' }] });
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Log in' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'claude-acp', approved: false }]);
  });

  it('a waiting login says where to finish it', async () => {
    const bridge = withSetup(
      { experts: [{ ...CLAUDE, state: 'needs_login' }] },
      { state: 'waiting' },
    );
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/Finish logging in in the window that opened/)).toBeVisible();
  });

  it('a login that was already done says so', async () => {
    const bridge = withSetup(
      { experts: [{ ...CLAUDE, state: 'needs_login' }] },
      { state: 'logged_in' },
    );
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Already logged in.')).toBeVisible();
  });

  it('a card that found the login done says so as a note', async () => {
    const bridge = withSetup(
      { experts: [{ ...CLAUDE, state: 'needs_login' }] },
      { error: 'already_logged_in' },
    );
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Already logged in.')).toBeVisible();
    expect(screen.queryByText('Setting that up didn’t work.')).toBeNull();
  });

  it('progress disables the row’s button and shows the stage', async () => {
    const bridge = withSetup({
      browseExperts: [CODEX],
      progress: { expert: 'codex-acp', stage: 'node', percent: 40 },
    });
    await renderPanel(bridge, 'Experts');
    expect(screen.getByRole('button', { name: 'Add Codex' })).toBeDisabled();
    expect(screen.getByText(/40%/)).toBeVisible();
  });

  it('reads the overview again when the brain says setup changed', async () => {
    const bridge = withSetup({});
    await renderPanel(bridge, 'Experts');
    expect(screen.queryByRole('button', { name: 'Add Codex' })).toBeNull();
    bridge.setup = { ...bridge.setup, browseExperts: [CODEX] };
    await act(async () => {
      bridge.emitChanged('setup');
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Add Codex' })).toBeInTheDocument();
  });

  it('a failed install is shown on the page by the expert’s name', async () => {
    await renderPanel(
      withSetup({ browseExperts: [CODEX], failed: { expert: 'codex-acp', error: 'integrity' } }),
      'Experts',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Codex/);
    expect(screen.getByRole('alert')).not.toHaveTextContent('codex-acp');
  });

  it.each([
    ['denied', /nothing was changed/i, false],
    ['already_installing', /already being set up/i, false],
    ['already_ready', /already set up/i, false],
    ['already_added', /already added/i, false],
    ['version_changed', /changed while you were deciding/i, true],
    ['registry_unavailable', /couldn’t reach the registry/i, true],
    ['something_new', /didn’t work/i, true],
  ])('a %s refusal gets its own line', async (error, line, isError) => {
    const bridge = createFakeHostBridge({
      apps: [FILES],
      setup: { browseExperts: [CODEX] },
      setupResult: { error },
    });
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    const shown = await screen.findByText(line);
    expect(shown).toHaveAttribute('role', isError ? 'alert' : 'status');
  });

  it('a call that succeeds leaves no line behind', async () => {
    const bridge = withSetup({ browseExperts: [CODEX] });
    await renderPanel(bridge, 'Experts');
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the offline note when the brain is away', async () => {
    const bridge = createFakeHostBridge({ listFails: 'brain offline' });
    await renderPanel(bridge, 'Experts');
    expect(await screen.findByRole('status')).toHaveTextContent(/brain isn’t running/i);
    expect(screen.queryByRole('region', { name: 'For long jobs' })).toBeNull();
  });

  it('long names and many entries stay inside the page', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...CODEX,
      id: `e${i}`,
      name: `A very long expert name that keeps going and going ${i}`,
      description: 'long '.repeat(80),
    }));
    await renderPanel(withSetup({ browseExperts: many }), 'Experts');
    // The row holds its text to one line with an ellipsis (home-entry__title/preview rules).
    expect(screen.getAllByRole('button', { name: /^Add A very long/ })).toHaveLength(30);
  });
});

const row = (id: string, name: string, official: boolean): AppRow => ({
  id,
  name,
  version: '1',
  description: `${name} app`,
  official,
  publisher: official ? 'notion.com' : id,
  runs: official ? 'hosted' : 'pc',
  host: official ? 'mcp.notion.com' : null,
  signIn: 'none',
  licence: 'MIT',
  repo: '',
});
const NOTION = row('com.notion/mcp', 'Notion', true);
const COMMUNITY = row('io.github.bob/notion', 'bobs', false);
const GROUP: AppGroup = { service: 'notion', official: NOTION, others: [COMMUNITY] };

const search = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: text } });
  await screen.findByRole('button', { name: 'Connect Notion' });
};

describe('ConnectionsPanel app search', () => {
  const found = () =>
    createFakeHostBridge({
      apps: [FILES],
      setupFor: (query) => (query === undefined ? { popular: [NOTION] } : { appGroups: [GROUP] }),
    });

  it('shows Popular before typing', async () => {
    await renderPanel(found());
    expect(await screen.findByRole('region', { name: 'Popular' })).toBeInTheDocument();
  });

  it('an official Connect sends one approved call without community ok', async () => {
    const bridge = found();
    await renderPanel(bridge);
    await search('notion');
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'app', id: 'com.notion/mcp', approved: true }]);
  });

  it('a community Connect anyway sends community ok; Back sends nothing', async () => {
    const bridge = found();
    await renderPanel(bridge);
    await search('notion');
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 other versions' }));
    await click(screen.getByRole('button', { name: 'Connect io.github.bob/notion' }));
    await click(screen.getByRole('button', { name: 'Back' }));
    expect(bridge.setupCalls).toEqual([]);
    await click(screen.getByRole('button', { name: 'Connect io.github.bob/notion' }));
    await click(screen.getByRole('button', { name: 'Connect anyway' }));
    expect(bridge.setupCalls).toEqual([
      { kind: 'app', id: 'io.github.bob/notion', approved: true, communityOk: true },
    ]);
  });

  it('Connect disables while the call runs, so a double press makes one call', async () => {
    let finish: (value: SetupResult) => void = () => undefined;
    const bridge = createFakeHostBridge({
      apps: [FILES],
      setupFor: () => ({ appGroups: [GROUP] }),
      setupResult: () => new Promise<SetupResult>((resolve) => (finish = resolve)),
    });
    await renderPanel(bridge);
    await search('notion');
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeDisabled();
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(bridge.setupCalls).toHaveLength(1);
    await act(async () => finish({}));
  });

  it('already added is a plain line, not an error', async () => {
    const bridge = createFakeHostBridge({
      apps: [FILES],
      setupFor: () => ({ appGroups: [GROUP] }),
      setupResult: { error: 'already_added' },
    });
    await renderPanel(bridge);
    await search('notion');
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    const line = await screen.findByText('That app is already added.');
    expect(line).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the Connected list when the registry cannot be reached', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES], overviewFails: 'no route' });
    await renderPanel(bridge);
    expect(await screen.findByText(/couldn’t reach the registry/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
  });

  it('the Experts tab says the same plain line when the overview fails, not blank', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES], overviewFails: 'no route' });
    await renderPanel(bridge, 'Experts');
    expect(await screen.findByText(/couldn’t reach the registry/i)).toBeInTheDocument();
  });

  it('a successful Official connect says it was added', async () => {
    const bridge = found();
    await renderPanel(bridge);
    await search('notion');
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(await screen.findByText('Notion added.')).toBeInTheDocument();
  });

  it('names the tab strip for Connections', async () => {
    await renderPanel(createFakeHostBridge({ apps: [FILES] }));
    expect(screen.getByRole('tablist', { name: 'Connections sections' })).toBeInTheDocument();
  });

  it('searches the registry again after a connect (the list moves on)', async () => {
    const bridge = found();
    await renderPanel(bridge);
    await search('notion');
    const before = bridge.setupOverviewCalls.length;
    await click(screen.getByRole('button', { name: 'Connect Notion' }));
    await waitFor(() => expect(bridge.setupOverviewCalls.length).toBeGreaterThan(before));
  });
});
