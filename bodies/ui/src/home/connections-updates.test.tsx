/** Tests for updates on the Connections page: the header, the row words, the buttons, the reload. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppInfo, SetupExpert, UpdateRow } from '../shapes';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const app = (id: string, name: string, transport: AppInfo['transport'] = 'stdio'): AppInfo => ({
  id,
  name,
  transport,
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [{ name: `${id}__a`, effect: 'look', locked: false }],
});
const upd = (over: Partial<UpdateRow>): UpdateRow => ({
  kind: 'app',
  id: 'github',
  name: 'GitHub',
  installed: '0.9',
  latest: '1.0',
  remote: false,
  official: true,
  auto: true,
  status: 'idle',
  ...over,
});
const expert = (id: string, name: string, over: Partial<SetupExpert> = {}): SetupExpert => ({
  id,
  name,
  version: '1.2',
  state: 'ready',
  tested: true,
  official: true,
  ...over,
});

async function open(bridge: FakeHostBridge, tab: 'Apps' | 'Experts' = 'Apps') {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Connections' });
  if (tab === 'Experts') fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
  await screen.findByText(/Checked|Not checked yet/);
}
const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
};

const APPS = [app('github', 'GitHub'), app('notion', 'Notion', 'http'), app('linear', 'Linear')];
const SETUP = {
  apps: [
    { id: 'github', name: 'GitHub', state: 'connected', official: true },
    { id: 'notion', name: 'Notion', state: 'connected', official: true },
    { id: 'linear', name: 'Linear', state: 'connected', official: false },
  ],
};
const ITEMS = [
  upd({}),
  upd({ id: 'notion', name: 'Notion', remote: true, installed: '', latest: null }),
  upd({
    id: 'linear',
    name: 'Linear',
    installed: '0.4',
    latest: '0.5',
    official: false,
    auto: false,
  }),
];

describe('updates on the Apps tab', () => {
  it('shows Checked N minutes ago, Check for updates and Update all (n) in the header', async () => {
    const checkedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const bridge = createFakeHostBridge({
      apps: APPS,
      setup: SETUP,
      updates: { checkedAt, items: ITEMS },
    });
    await open(bridge);
    expect(screen.getByText('Checked 5 minutes ago')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update all (2)' })).toBeVisible();
    await click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(bridge.updateCalls).toEqual(['check']);
  });

  it('a row shows v0.9 → v1.0 and an Update button that updates that app', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP, updates: { items: ITEMS } });
    await open(bridge);
    const row = within(screen.getByRole('region', { name: 'GitHub' }));
    expect(row.getByText(/v0\.9 → v1\.0/)).toBeVisible();
    await click(row.getByRole('button', { name: 'Update GitHub' }));
    expect(bridge.updateCalls).toEqual(['item app github']);
  });

  it('Update all asks for the apps', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP, updates: { items: ITEMS } });
    await open(bridge);
    await click(screen.getByRole('button', { name: 'Update all (2)' }));
    expect(bridge.updateCalls).toEqual(['all app']);
  });

  it('a remote app says Always up to date and has no update controls', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP, updates: { items: ITEMS } });
    await open(bridge);
    const row = within(screen.getByRole('region', { name: 'Notion' }));
    expect(row.getByText(/Always up to date/)).toBeVisible();
    expect(row.queryByRole('button', { name: /Update/ })).toBeNull();
  });

  it('a community app with automatic updates off says Waits for you', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP, updates: { items: ITEMS } });
    await open(bridge);
    expect(
      within(screen.getByRole('region', { name: 'Linear' })).getByText(/Waits for you/),
    ).toBeVisible();
  });

  it('the group switches default from trust and a press sends the change', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP });
    await open(bridge);
    expect(
      screen.getByRole('switch', { name: 'Keep Official apps up to date automatically' }),
    ).toBeChecked();
    const community = screen.getByRole('switch', {
      name: 'Keep Community apps up to date automatically',
    });
    expect(community).not.toBeChecked();
    await click(community);
    expect(bridge.updateCalls).toEqual(['auto app community on']);
  });

  it('shows Updating… and then Updated to vX. inline as the brain reports it', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP, updates: { items: ITEMS } });
    await open(bridge);
    bridge.updates = {
      ...bridge.updates,
      items: [upd({ status: 'updating' }), ...ITEMS.slice(1)],
    };
    await act(async () => {
      bridge.emitChanged('updates');
      await Promise.resolve();
    });
    const row = within(screen.getByRole('region', { name: 'GitHub' }));
    expect(await row.findByText('Updating…')).toBeVisible();
    bridge.updates = {
      ...bridge.updates,
      items: [upd({ status: 'updated', installed: '1.0', latest: null }), ...ITEMS.slice(1)],
    };
    await act(async () => {
      bridge.emitChanged('updates');
      await Promise.resolve();
    });
    expect(await row.findByText('Updated to v1.0.')).toBeVisible();
  });

  it('a row waiting for a running job says so', async () => {
    const bridge = createFakeHostBridge({
      apps: APPS,
      setup: SETUP,
      updates: { items: [upd({ status: 'waiting' }), ...ITEMS.slice(1)] },
    });
    await open(bridge);
    expect(
      within(screen.getByRole('region', { name: 'GitHub' })).getByText(
        'Waiting for a job to finish…',
      ),
    ).toBeVisible();
  });

  it('shows no update words when the brain has none to give', async () => {
    const bridge = createFakeHostBridge({ apps: APPS, setup: SETUP });
    await open(bridge);
    expect(screen.queryByRole('button', { name: /Update all/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'GitHub' })).queryByText(/→/)).toBeNull();
  });
});

describe('updates on the Experts tab', () => {
  const EXPERTS = {
    experts: [expert('claude-acp', 'Claude Code'), expert('foo', 'Foo', { official: false })],
  };
  const E_ITEMS = [
    upd({ kind: 'expert', id: 'claude-acp', name: 'Claude Code', installed: '1.2', latest: '1.3' }),
    upd({
      kind: 'expert',
      id: 'foo',
      name: 'Foo',
      installed: '0.3',
      latest: '0.4',
      official: false,
      auto: false,
    }),
  ];

  it('shows the header, v1.2 → v1.3 and Update on the row', async () => {
    const bridge = createFakeHostBridge({ setup: EXPERTS, updates: { items: E_ITEMS } });
    await open(bridge, 'Experts');
    expect(screen.getByRole('button', { name: 'Update all (2)' })).toBeVisible();
    const row = within(screen.getByRole('region', { name: 'Claude Code' }));
    expect(row.getByText(/v1\.2 → v1\.3/)).toBeVisible();
    await click(row.getByRole('button', { name: 'Update Claude Code' }));
    expect(bridge.updateCalls).toEqual(['item expert claude-acp']);
    expect(
      within(screen.getByRole('region', { name: 'Foo' })).getByText(/Waits for you/),
    ).toBeVisible();
  });

  it('has the experts switches', async () => {
    const bridge = createFakeHostBridge({ setup: EXPERTS, updates: { items: E_ITEMS } });
    await open(bridge, 'Experts');
    await click(
      screen.getByRole('switch', { name: 'Keep Community experts up to date automatically' }),
    );
    expect(bridge.updateCalls).toEqual(['auto expert community on']);
  });
});
