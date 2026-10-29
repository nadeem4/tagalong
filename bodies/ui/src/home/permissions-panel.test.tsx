/** Tests for PermissionsPanel: one row per tool, the Ask/Auto switch and the refetch on change. */

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
  online: true,
};
const READ: PermissionRow = {
  name: 'recall',
  description: 'Look up what Scout remembers',
  effect: 'read',
  mode: 'auto',
  locked: false,
  online: true,
};
const FORGET: PermissionRow = {
  name: 'forget',
  description: 'Delete a memory',
  effect: 'change',
  mode: 'ask',
  locked: true,
  online: true,
};
const OFFLINE: PermissionRow = {
  name: 'extension__open_tab',
  description: 'Open a browser tab',
  effect: 'change',
  mode: 'ask',
  locked: false,
  online: false,
};

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <PermissionsPanel />
    </HostBridgeProvider>,
  );
}

const rows = async () =>
  within(await screen.findByRole('list', { name: 'Permissions' })).getAllByRole('listitem');

describe('PermissionsPanel', () => {
  it('lists one row per tool with its description and switch state', async () => {
    renderPanel(createFakeHostBridge({ permissions: [MOVE, READ] }));
    const [move, read] = await rows();
    expect(move).toHaveTextContent('desktop__move_window');
    expect(move).toHaveTextContent('Move a window on your desktop');
    expect(within(move!).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(within(move!).getByRole('switch')).toHaveTextContent('Ask');
    expect(within(read!).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(read!).getByRole('switch')).toHaveTextContent('Auto');
  });

  it('sets a tool to auto when its switch is clicked, then shows the new mode', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'desktop__move_window' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(bridge.permissionSets).toEqual([{ tool: 'desktop__move_window', mode: 'auto' }]);
  });

  it('sets an auto tool back to ask', async () => {
    const bridge = createFakeHostBridge({ permissions: [READ] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('switch', { name: 'recall' }));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'recall', mode: 'ask' }]));
  });

  it('shows a locked tool as Ask, marked risky, with an enabled switch', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'forget' });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent('Ask');
    expect(screen.getByText('Risky action')).toBeInTheDocument();
    expect(screen.queryByText('Always asks')).toBeNull();
  });

  it('turning a locked tool to Auto shows a risk warning and does not call setPermission yet', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('switch', { name: 'forget' }));
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/risky action/i);
    expect(warning).toHaveTextContent(/no longer ask/i);
    expect(bridge.permissionSets).toEqual([]);
  });

  it('confirming the warning calls setPermission with auto', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'forget' });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'auto' }]));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('cancelling the warning leaves the switch on Ask and calls nothing', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'forget' });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('turning a locked tool back to Ask needs no confirmation', async () => {
    const bridge = createFakeHostBridge({ permissions: [{ ...FORGET, mode: 'auto' }] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('switch', { name: 'forget' }));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'ask' }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an unlocked tool turns to Auto without a warning', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('switch', { name: 'desktop__move_window' }));
    await waitFor(() => expect(bridge.permissionSets).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('puts focus on Cancel when the warning opens and describes the switch by it', async () => {
    renderPanel(createFakeHostBridge({ permissions: [FORGET] }));
    const toggle = await screen.findByRole('switch', { name: 'forget' });
    fireEvent.click(toggle);
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    const warning = screen.getByRole('alert');
    expect(toggle).toHaveAttribute('aria-describedby', warning.id);
  });

  it('Escape cancels the warning, calls nothing and returns focus to the switch', async () => {
    const bridge = createFakeHostBridge({ permissions: [FORGET] });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'forget' });
    fireEvent.click(toggle);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle).toHaveFocus();
    expect(toggle).not.toHaveAttribute('aria-describedby');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('says a tool that asks itself does so, with the switch disabled', async () => {
    const bridge = createFakeHostBridge({
      permissions: [{ ...MOVE, name: 'hand_off', self_asks: true }],
    });
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'hand_off' });
    expect(screen.getByText('Asks itself')).toBeInTheDocument();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(bridge.permissionSets).toEqual([]);
  });

  it('marks an offline body’s tool Not connected and leaves its switch off limits', async () => {
    const bridge = createFakeHostBridge({ permissions: [OFFLINE] });
    renderPanel(bridge);
    const [row] = await rows();
    expect(row).toHaveTextContent('Not connected');
    expect(row).toHaveClass('perm-row--offline');
    const toggle = within(row!).getByRole('switch');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(bridge.permissionSets).toEqual([]);
  });

  it('reads again when the brain says permissions changed, and only then', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    renderPanel(bridge);
    await rows();
    bridge.permissions = [{ ...MOVE, mode: 'auto' }];
    act(() => bridge.emitChanged('memory'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    act(() => bridge.emitChanged('permissions'));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the row and reads again when the brain refuses the change', async () => {
    const bridge = createFakeHostBridge({ permissions: [MOVE] });
    bridge.setPermission = () => Promise.reject(new Error('refused'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    const toggle = await screen.findByRole('switch', { name: 'desktop__move_window' });
    fireEvent.click(toggle);
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
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

  it('shows nothing on a host without permissions', () => {
    const bridge = createFakeHostBridge();
    delete bridge.listPermissions;
    renderPanel(bridge);
    expect(screen.queryByRole('region', { name: 'Permissions' })).toBeNull();
  });
});
