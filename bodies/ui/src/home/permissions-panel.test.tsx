/**
 * Tests for PermissionsPanel: tools grouped by source, one Off/Ask/Auto control per tool, the
 * options each tool allows, the risk warning, and the refetch when the brain says things changed.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type PermissionRow } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { PermissionsPanel } from './permissions-panel';

const MOVE: PermissionRow = {
  name: 'desktop__move_window',
  description: 'Move a window on your desktop',
  effect: 'change',
  mode: 'ask',
  locked: false,
  person_only: false,
  online: true,
  source: 'body:desktop',
  source_name: 'Desktop',
};
const READ: PermissionRow = {
  name: 'recall',
  description: 'Look up what Scout remembers',
  effect: 'read',
  mode: 'auto',
  locked: false,
  person_only: false,
  online: true,
  source: 'built_in',
  source_name: 'Built in',
};
const FORGET: PermissionRow = {
  name: 'forget',
  description: 'Delete a memory',
  effect: 'change',
  mode: 'ask',
  locked: true,
  person_only: false,
  online: true,
  source: 'built_in',
  source_name: 'Built in',
};
const OFFLINE: PermissionRow = {
  name: 'extension__open_tab',
  description: 'Open a browser tab',
  effect: 'change',
  mode: 'ask',
  locked: false,
  person_only: false,
  online: false,
  source: 'body:extension',
  source_name: 'Chrome on work PC',
};
const MAIL: PermissionRow = {
  name: 'gmail__send_mail',
  description: 'Send an email',
  effect: 'change',
  mode: 'ask',
  locked: false,
  person_only: false,
  online: true,
  source: 'app:gmail',
  source_name: 'Gmail',
};

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <PermissionsPanel />
    </HostBridgeProvider>,
  );
}

// The group is named by the visible tool name, without its source prefix.
const group = (tool: string) =>
  screen.findByRole('radiogroup', { name: tool.replace(/^.*__/, '') });
const radio = (el: HTMLElement, name: string) => within(el).getByRole('radio', { name });

describe('PermissionsPanel', () => {
  it('sits in a home-card section labelled Permissions', async () => {
    renderPanel(createFakeHostBridge({ permissions: [MOVE] }));
    await group(MOVE.name);
    expect(screen.getByRole('region', { name: 'Permissions' })).toHaveClass('home-card');
  });

  it('groups tools by source, titled with the name the body or app declared', async () => {
    renderPanel(createFakeHostBridge({ permissions: [MAIL, OFFLINE, MOVE, READ] }));
    await group(READ.name);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Built in', 'Desktop', 'Chrome on work PC', 'Gmail']);
    const desktop = screen.getByRole('list', { name: 'Desktop' });
    expect(within(desktop).getAllByRole('listitem')).toHaveLength(1);
    expect(desktop).toHaveTextContent('move_window');
    expect(desktop).toHaveTextContent('Move a window on your desktop');
  });

  it('keeps the brain order of tools inside a group', async () => {
    const other = { ...READ, name: 'remember', description: 'Save a memory' };
    renderPanel(createFakeHostBridge({ permissions: [READ, other] }));
    await group(READ.name);
    const items = within(screen.getByRole('list', { name: 'Built in' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('recall');
    expect(items[1]).toHaveTextContent('remember');
  });

  it('shows Off, Ask and Auto per tool with the brain mode chosen', async () => {
    renderPanel(createFakeHostBridge({ permissions: [MOVE, READ, { ...MAIL, mode: 'off' }] }));
    const move = await group(MOVE.name);
    expect(
      within(move)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask', 'Auto']);
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    expect(radio(await group(READ.name), 'Auto')).toHaveAttribute('aria-checked', 'true');
    expect(radio(await group(MAIL.name), 'Off')).toHaveAttribute('aria-checked', 'true');
  });

  it('dims the text of a tool that is Off', async () => {
    renderPanel(createFakeHostBridge({ permissions: [{ ...MOVE, mode: 'off' }] }));
    const row = (await group(MOVE.name)).closest('li');
    expect(row).toHaveClass('perm-row--off');
  });

  it('sets a tool to Auto, then shows the new mode', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    renderPanel(bridge);
    const move = await group(MOVE.name);
    fireEvent.click(radio(move, 'Auto'));
    await waitFor(() => expect(radio(move, 'Auto')).toHaveAttribute('aria-checked', 'true'));
    expect(bridge.permissionSets).toEqual([{ tool: MOVE.name, mode: 'auto' }]);
  });

  it('turns a tool Off and back to Ask', async () => {
    const bridge = createFakeHostBridge({ permissions: [READ] });
    renderPanel(bridge);
    const recall = await group(READ.name);
    fireEvent.click(radio(recall, 'Off'));
    await waitFor(() => expect(radio(recall, 'Off')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(radio(recall, 'Ask'));
    await waitFor(() => expect(radio(recall, 'Ask')).toHaveAttribute('aria-checked', 'true'));
    expect(bridge.permissionSets).toEqual([
      { tool: 'recall', mode: 'off' },
      { tool: 'recall', mode: 'ask' },
    ]);
  });

  it('never offers Auto for a person-only tool', async () => {
    renderPanel(createFakeHostBridge({ permissions: [{ ...MAIL, person_only: true }] }));
    const mail = await group(MAIL.name);
    expect(
      within(mail)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask']);
    expect(screen.getByText('Always asks')).toBeInTheDocument();
  });

  it('marks a locked tool risky and warns before Auto, calling nothing yet', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const forget = await group(FORGET.name);
    expect(screen.getByText('Risky action')).toBeInTheDocument();
    fireEvent.click(radio(forget, 'Auto'));
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/risky action/i);
    expect(warning).toHaveTextContent(/no longer ask/i);
    expect(bridge.permissionSets).toEqual([]);
  });

  it('confirming the warning calls setPermission with auto', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const forget = await group(FORGET.name);
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'auto' }]));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(radio(forget, 'Auto')).toHaveAttribute('aria-checked', 'true'));
  });

  it('cancelling the warning leaves Ask chosen and calls nothing', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const forget = await group(FORGET.name);
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(radio(forget, 'Ask')).toHaveAttribute('aria-checked', 'true');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('turning a locked tool Off or back to Ask needs no confirmation', async () => {
    const bridge = createFakeHostBridge({ permissions: [{ ...FORGET, mode: 'auto' }] });
    renderPanel(bridge);
    const forget = await group(FORGET.name);
    fireEvent.click(radio(forget, 'Off'));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'off' }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts focus on Cancel when the warning opens and describes the control by it', async () => {
    renderPanel(createFakeHostBridge({ permissions: [FORGET] }));
    const forget = await group(FORGET.name);
    fireEvent.click(radio(forget, 'Auto'));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(forget).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  });

  it('Escape cancels the warning, calls nothing and returns focus to the control', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const forget = await group(FORGET.name);
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(radio(forget, 'Ask')).toHaveFocus();
    expect(forget).not.toHaveAttribute('aria-describedby');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('offers a tool that asks itself only Off and Ask, shown as Ask while it is on', async () => {
    const bridge = createFakeHostBridge({
      permissions: [{ ...READ, name: 'hand_off', self_asks: true }],
    });
    renderPanel(bridge);
    const handOff = await group('hand_off');
    expect(screen.getByText('Asks itself')).toBeInTheDocument();
    expect(
      within(handOff)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask']);
    expect(radio(handOff, 'Ask')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio(handOff, 'Off'));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'hand_off', mode: 'off' }]));
    fireEvent.click(radio(handOff, 'Ask'));
    await waitFor(() => expect(bridge.permissionSets).toHaveLength(2));
    expect(bridge.permissionSets[1]).toEqual({ tool: 'hand_off', mode: 'ask' });
  });

  it('offers a server tool only Off and Auto, since Anthropic runs it and no ask can reach it', async () => {
    const bridge = createFakeHostBridge({
      permissions: [{ ...READ, name: 'web_search', mode: 'auto', server_tool: true }],
    });
    renderPanel(bridge);
    const row = await group('web_search');
    expect(
      within(row)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Auto']);
    expect(radio(row, 'Auto')).toHaveAttribute('aria-checked', 'true');
  });

  it('greys a tool of a body that is not connected and says so, but can still set it', async () => {
    const bridge = createFakeHostBridge({ permissions: [OFFLINE] });
    renderPanel(bridge);
    const tab = await group(OFFLINE.name);
    const row = tab.closest('li');
    expect(row).toHaveTextContent('Not connected');
    expect(row).toHaveClass('perm-row--offline');
    fireEvent.click(radio(tab, 'Off'));
    await waitFor(() =>
      expect(bridge.permissionSets).toEqual([{ tool: OFFLINE.name, mode: 'off' }]),
    );
  });

  it('reads again when the brain says permissions changed, and only then', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    renderPanel(bridge);
    const move = await group(MOVE.name);
    bridge.permissions = [{ ...MOVE, mode: 'auto' }];
    act(() => bridge.emitChanged('memory'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    act(() => bridge.emitChanged('permissions'));
    await waitFor(() => expect(radio(move, 'Auto')).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the row and reads again when the brain refuses the change', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    bridge.setPermission = () => Promise.reject(new Error('refused'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    const move = await group(MOVE.name);
    fireEvent.click(radio(move, 'Auto'));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    errors.mockRestore();
  });

  it('has an empty state', async () => {
    renderPanel(createFakeHostBridge({ permissions: [] }));
    expect(await screen.findByText('Scout has no tools yet.')).toBeInTheDocument();
  });

  it('says so when the permissions cannot be read', async () => {
    const bridge = createFakeHostBridge();
    bridge.listPermissions = () => Promise.reject(new Error('brain down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/);
    vi.restoreAllMocks();
  });

  it('stops listening for changes when it goes away', async () => {
    const bridge = createFakeHostBridge({ permissions: [] });
    const off = vi.fn();
    bridge.onBrainChanged = () => off;
    const { unmount } = render(
      <HostBridgeProvider bridge={bridge}>
        <PermissionsPanel />
      </HostBridgeProvider>,
    );
    await screen.findByText('Scout has no tools yet.');
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
