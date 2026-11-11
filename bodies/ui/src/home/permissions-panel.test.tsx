/**
 * Tests for PermissionsPanel: tools in collapsible groups with plain words, one Off/Ask/Auto
 * control per tool, the options each tool allows, the badges and risk warning, and the refetch
 * when the brain says things changed. Searching has its own describe at the end.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type PermissionGroup, type PermissionRow } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { PermissionsPanel } from './permissions-panel';

const row = (
  over: Partial<PermissionRow> & Pick<PermissionRow, 'name' | 'title'>,
): PermissionRow => ({
  description: `The model's own text for ${over.name}`,
  line: `${over.title} line.`,
  info: `${over.title} info.`,
  group: 'computer',
  effect: 'change',
  mode: 'ask',
  locked: false,
  person_only: false,
  online: true,
  source: 'body:desktop',
  source_name: 'Desktop',
  ...over,
});

const MOVE = row({ name: 'desktop__move_file', title: 'Move files', line: 'Moves a file.' });
const READ = row({
  name: 'recall',
  title: 'Look back in memory',
  line: 'Searches saved notes.',
  info: 'It only reads; nothing changes.',
  group: 'memory',
  mode: 'auto',
  effect: 'read',
  source: 'built_in',
  source_name: 'Built in',
});
const FORGET = row({
  name: 'forget',
  title: 'Forget something',
  group: 'memory',
  locked: true,
  source: 'built_in',
  source_name: 'Built in',
});
const OPEN = row({ name: 'desktop__open_url', title: 'Open a link', locked: true, mode: 'auto' });
const OFFLINE = row({
  name: 'extension__tabs',
  title: 'See and read tabs',
  group: 'browser',
  online: false,
  source: 'body:extension',
  source_name: 'Chrome on work PC',
});
const MAIL = row({
  name: 'gmail__send_mail',
  title: 'send_mail',
  line: 'Send an email',
  info: 'Needs a signed-in account.',
  group: 'app:gmail',
  source: 'app:gmail',
  source_name: 'Gmail',
});

const GROUPS: PermissionGroup[] = [
  { id: 'memory', title: 'Memory', note: 'Things Scout keeps between chats.' },
  { id: 'computer', title: 'This computer', note: 'Windows and files.' },
  { id: 'web', title: 'The web', note: "Runs on Anthropic's side." },
  { id: 'browser', title: 'Chrome on work PC', note: 'Your browser' },
  { id: 'app:gmail', title: 'Gmail', note: 'From Gmail' },
];

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <PermissionsPanel />
    </HostBridgeProvider>,
  );
}

const bridgeOf = (...rows: PermissionRow[]) =>
  createFakeHostBridge({ permissions: rows, permissionGroups: GROUPS });

const header = (title: string) => screen.findByRole('button', { name: new RegExp(`^${title}`) });

/** Opens a group by its header and returns the control of one tool, named by its plain title. */
async function opened(group: string, title: string) {
  const head = await header(group);
  if (head.getAttribute('aria-expanded') !== 'true') fireEvent.click(head);
  return screen.getByRole('radiogroup', { name: title });
}
const radio = (el: HTMLElement, name: string) => within(el).getByRole('radio', { name });

describe('PermissionsPanel', () => {
  it('sits in a home-card section labelled Permissions with the three modes explained', async () => {
    renderPanel(bridgeOf(MOVE));
    await header('This computer');
    const card = screen.getByRole('region', { name: 'Permissions' });
    expect(card).toHaveClass('home-card');
    expect(card).toHaveTextContent(
      'Off: Scout leaves it alone. Ask: checks with you first. Auto: just does it.',
    );
  });

  it('groups are collapsed by default and open on click', async () => {
    renderPanel(bridgeOf(MOVE, READ));
    const head = await header('This computer');
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Move files')).toBeNull();
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Move files')).toBeInTheDocument();
    expect(screen.getByText('Windows and files.')).toBeInTheDocument();
    fireEvent.click(head);
    expect(screen.queryByText('Move files')).toBeNull();
  });

  it('lists groups in the order the brain sends them and hides groups with no tools', async () => {
    renderPanel(bridgeOf(MAIL, MOVE, READ));
    await header('Memory');
    const heads = screen.getAllByRole('button', { expanded: false });
    expect(heads).toHaveLength(3);
    ['Memory', 'This computer', 'Gmail'].forEach((name, i) =>
      expect(heads[i]?.textContent).toContain(name),
    );
  });

  it('header summary counts modes', async () => {
    const more = row({ name: 'desktop__rename_file', title: 'Rename files', mode: 'ask' });
    const auto = row({ name: 'desktop__list_files', title: 'See files', mode: 'auto' });
    renderPanel(bridgeOf(MOVE, more, auto, READ));
    expect(await header('This computer')).toHaveTextContent('3 · 2 Ask, 1 Auto');
    expect(await header('Memory')).toHaveTextContent('1 · all Auto');
  });

  it('counts a tool that asks itself as Ask and a server group as Off or Auto', async () => {
    const handOff = row({ name: 'hand_off', title: 'Hand work', mode: 'auto', self_asks: true });
    const search = row({
      name: 'web_search',
      title: 'Search the web',
      group: 'web',
      mode: 'auto',
      server_tool: true,
    });
    renderPanel(bridgeOf(handOff, search));
    expect(await header('This computer')).toHaveTextContent('1 · all Ask');
    expect(await header('The web')).toHaveTextContent('1 · Off or Auto · all Auto');
  });

  it('risky flag counts risky tools on Auto and says tool or tools', async () => {
    const other = row({
      name: 'desktop__write_file',
      title: 'Write files',
      locked: true,
      mode: 'auto',
    });
    renderPanel(bridgeOf(OPEN, MOVE));
    expect(await header('This computer')).toHaveTextContent('1 risky tool on Auto');
  });

  it('risky flag says tools for more than one', async () => {
    const other = row({
      name: 'desktop__write_file',
      title: 'Write files',
      locked: true,
      mode: 'auto',
    });
    renderPanel(bridgeOf(OPEN, other));
    expect(await header('This computer')).toHaveTextContent('2 risky tools on Auto');
  });

  it('shows no risky flag while a risky tool is on Ask', async () => {
    renderPanel(bridgeOf({ ...OPEN, mode: 'ask' }));
    expect(await header('This computer')).not.toHaveTextContent('risky');
  });

  it('row shows title and line, not the code name or the model description', async () => {
    renderPanel(bridgeOf(MOVE));
    await opened('This computer', 'Move files');
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Move files');
    expect(item).toHaveTextContent('Moves a file.');
    expect(item).not.toHaveTextContent('move_file');
    expect(item).not.toHaveTextContent("The model's own text");
  });

  it('keeps the brain order of tools inside a group', async () => {
    const other = row({ name: 'remember', title: 'Remember things', group: 'memory' });
    renderPanel(bridgeOf(READ, other));
    await opened('Memory', 'Look back in memory');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Look back in memory');
    expect(items[1]).toHaveTextContent('Remember things');
  });

  it('badges Always asks and Risky are on the row, never behind info', async () => {
    const asks = row({
      name: 'desktop__delete_file',
      title: 'Delete files',
      person_only: true,
      locked: true,
    });
    renderPanel(bridgeOf(asks, OPEN));
    await opened('This computer', 'Delete files');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Always asks');
    expect(items[0]).not.toHaveTextContent('Risky');
    expect(items[1]).toHaveTextContent('Risky');
    expect(items[1]).not.toHaveTextContent('Always asks');
  });

  it('app group says From <app> and puts the rest of the text behind info', async () => {
    renderPanel(bridgeOf(MAIL));
    const head = await header('Gmail');
    expect(head).toHaveTextContent('From Gmail');
    fireEvent.click(head);
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('send_mail');
    expect(item).toHaveTextContent('Send an email');
    expect(item).not.toHaveTextContent('Needs a signed-in account.');
    fireEvent.click(within(item).getByRole('button', { name: 'About send_mail' }));
    expect(screen.getByRole('dialog', { name: 'About send_mail' })).toHaveTextContent(
      'Needs a signed-in account.',
    );
  });

  it('shows Off, Ask and Auto per tool with the brain mode chosen', async () => {
    renderPanel(bridgeOf(MOVE, READ, { ...MAIL, mode: 'off' }));
    const move = await opened('This computer', 'Move files');
    expect(
      within(move)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask', 'Auto']);
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    expect(radio(await opened('Memory', 'Look back in memory'), 'Auto')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(radio(await opened('Gmail', 'send_mail'), 'Off')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('dims the text of a tool that is Off', async () => {
    renderPanel(bridgeOf({ ...MOVE, mode: 'off' }));
    const move = await opened('This computer', 'Move files');
    expect(move.closest('li')).toHaveClass('perm-row--off');
  });

  it('sets a tool to Auto by its friendly name, then shows the new mode', async () => {
    const bridge = bridgeOf(MOVE);
    renderPanel(bridge);
    const move = await opened('This computer', 'Move files');
    fireEvent.click(radio(move, 'Auto'));
    await waitFor(() => expect(radio(move, 'Auto')).toHaveAttribute('aria-checked', 'true'));
    expect(bridge.permissionSets).toEqual([{ tool: MOVE.name, mode: 'auto' }]);
  });

  it('turns a tool Off and back to Ask', async () => {
    const bridge = bridgeOf(READ);
    renderPanel(bridge);
    const recall = await opened('Memory', 'Look back in memory');
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
    renderPanel(bridgeOf({ ...MAIL, person_only: true }));
    const mail = await opened('Gmail', 'send_mail');
    expect(
      within(mail)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask']);
    expect(screen.getByText('Always asks')).toBeInTheDocument();
  });

  it('warns before Auto on a locked tool, calling nothing yet', async () => {
    const bridge = bridgeOf(FORGET);
    renderPanel(bridge);
    const forget = await opened('Memory', 'Forget something');
    expect(screen.getByText('Risky')).toBeInTheDocument();
    fireEvent.click(radio(forget, 'Auto'));
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/risky action/i);
    expect(warning).toHaveTextContent(/no longer ask/i);
    expect(bridge.permissionSets).toEqual([]);
  });

  it('confirming the warning calls setPermission with auto', async () => {
    const bridge = bridgeOf(FORGET);
    renderPanel(bridge);
    const forget = await opened('Memory', 'Forget something');
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'auto' }]));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(radio(forget, 'Auto')).toHaveAttribute('aria-checked', 'true'));
  });

  it('cancelling the warning leaves Ask chosen and calls nothing', async () => {
    const bridge = bridgeOf(FORGET);
    renderPanel(bridge);
    const forget = await opened('Memory', 'Forget something');
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(radio(forget, 'Ask')).toHaveAttribute('aria-checked', 'true');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('turning a locked tool Off or back to Ask needs no confirmation', async () => {
    const bridge = bridgeOf({ ...FORGET, mode: 'auto' });
    renderPanel(bridge);
    const forget = await opened('Memory', 'Forget something');
    fireEvent.click(radio(forget, 'Off'));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'forget', mode: 'off' }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts focus on Cancel when the warning opens and describes the control by it', async () => {
    renderPanel(bridgeOf(FORGET));
    const forget = await opened('Memory', 'Forget something');
    fireEvent.click(radio(forget, 'Auto'));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(forget).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  });

  it('Escape cancels the warning, calls nothing and returns focus to the control', async () => {
    const bridge = bridgeOf(FORGET);
    renderPanel(bridge);
    const forget = await opened('Memory', 'Forget something');
    fireEvent.click(radio(forget, 'Auto'));
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(radio(forget, 'Ask')).toHaveFocus();
    expect(forget).not.toHaveAttribute('aria-describedby');
    expect(bridge.permissionSets).toEqual([]);
  });

  it('offers a tool that asks itself only Off and Ask, shown as Ask while it is on', async () => {
    const handOff = row({ name: 'hand_off', title: 'Hand work', mode: 'auto', self_asks: true });
    const bridge = bridgeOf(handOff);
    renderPanel(bridge);
    const control = await opened('This computer', 'Hand work');
    expect(screen.getByText('Always asks')).toBeInTheDocument();
    expect(
      within(control)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Ask']);
    expect(radio(control, 'Ask')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio(control, 'Off'));
    await waitFor(() => expect(bridge.permissionSets).toEqual([{ tool: 'hand_off', mode: 'off' }]));
    fireEvent.click(radio(control, 'Ask'));
    await waitFor(() => expect(bridge.permissionSets).toHaveLength(2));
    expect(bridge.permissionSets[1]).toEqual({ tool: 'hand_off', mode: 'ask' });
  });

  it('offers a server tool only Off and Auto, since no ask can reach it', async () => {
    const search = row({
      name: 'web_search',
      title: 'Search the web',
      group: 'web',
      mode: 'auto',
      server_tool: true,
    });
    renderPanel(bridgeOf(search));
    const control = await opened('The web', 'Search the web');
    expect(
      within(control)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Off', 'Auto']);
    expect(radio(control, 'Auto')).toHaveAttribute('aria-checked', 'true');
  });

  it('greys a tool of a body that is not connected and says so, but can still set it', async () => {
    const bridge = bridgeOf(OFFLINE);
    renderPanel(bridge);
    const tab = await opened('Chrome on work PC', 'See and read tabs');
    const item = tab.closest('li');
    expect(item).toHaveTextContent('Not connected');
    expect(item).toHaveClass('perm-row--offline');
    fireEvent.click(radio(tab, 'Off'));
    await waitFor(() =>
      expect(bridge.permissionSets).toEqual([{ tool: OFFLINE.name, mode: 'off' }]),
    );
  });

  it('reads again when the brain says permissions changed, and only then', async () => {
    const bridge = bridgeOf(MOVE);
    renderPanel(bridge);
    const move = await opened('This computer', 'Move files');
    bridge.permissions = [{ ...MOVE, mode: 'auto' }];
    act(() => bridge.emitChanged('memory'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    act(() => bridge.emitChanged('permissions'));
    await waitFor(() => expect(radio(move, 'Auto')).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the row and reads again when the brain refuses the change', async () => {
    const bridge = bridgeOf(MOVE);
    bridge.setPermission = () => Promise.reject(new Error('refused'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel(bridge);
    const move = await opened('This computer', 'Move files');
    fireEvent.click(radio(move, 'Auto'));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(radio(move, 'Ask')).toHaveAttribute('aria-checked', 'true');
    errors.mockRestore();
  });

  it('has an empty state', async () => {
    renderPanel(bridgeOf());
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
    const bridge = bridgeOf();
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

describe('PermissionsPanel search', () => {
  const find = (term: string) =>
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a permission' }), {
      target: { value: term },
    });

  it('has a search field labelled Find a permission', async () => {
    renderPanel(bridgeOf(MOVE));
    await header('This computer');
    const field = screen.getByRole('searchbox', { name: 'Find a permission' });
    expect(field).toHaveAttribute('placeholder', 'Find a permission');
  });

  it('search matches title, line or info, any case', async () => {
    renderPanel(bridgeOf(MOVE, READ));
    await header('Memory');
    find('LOOK BACK'); // title
    expect(screen.getByText('Look back in memory')).toBeInTheDocument();
    find('searches SAVED'); // line
    expect(screen.getByText('Look back in memory')).toBeInTheDocument();
    find('only reads'); // only in the info text, never drawn on the row
    expect(screen.getByText('Look back in memory')).toBeInTheDocument();
  });

  it('groups with a match open and others hide', async () => {
    renderPanel(bridgeOf(MOVE, READ));
    await header('Memory');
    find('move');
    expect(screen.getByText('Move files')).toBeInTheDocument();
    expect(screen.queryByText('Look back in memory')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Memory/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^This computer/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows only the matching tools of an open group', async () => {
    renderPanel(bridgeOf(MOVE, OPEN));
    await header('This computer');
    find('open a');
    expect(screen.getByText('Open a link')).toBeInTheDocument();
    expect(screen.queryByText('Move files')).toBeNull();
  });

  it('clearing restores collapsed groups', async () => {
    renderPanel(bridgeOf(MOVE, READ));
    await header('Memory');
    find('move');
    find('');
    expect(screen.getByRole('button', { name: /^Memory/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /^This computer/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Move files')).toBeNull();
  });

  it('no match says so', async () => {
    renderPanel(bridgeOf(MOVE));
    await header('This computer');
    find('zebra');
    expect(screen.getByText('No permission matches "zebra".')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^This computer/ })).toBeNull();
  });
});
