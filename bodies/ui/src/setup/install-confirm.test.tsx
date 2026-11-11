/**
 * Tests for InstallConfirm: the install ask in the chat is one card that stays and follows the
 * install (Allow, working, done, failed), instead of vanishing when the person answers.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorConfirmParams } from '../shapes';
import { HostBridgeProvider } from '../host-bridge';
import { CompanionBubble } from '../companion-bubble';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { InstallConfirm } from './install-confirm';

const APP_ASK: ConnectorConfirmParams = {
  approvalId: 'a1',
  tool: 'install_app',
  question: 'Install Notion?',
  options: [],
  facts: { app: 'notion', official: true, publisher: 'Notion', runs: 'hosted', sign_in: 'browser' },
} as unknown as ConnectorConfirmParams;

const EXPERT_ASK: ConnectorConfirmParams = {
  approvalId: 'a2',
  tool: 'install_expert',
  question: 'Install Claude Code?',
  options: [],
  facts: { expert: 'claude-acp' },
} as unknown as ConnectorConfirmParams;

function show(confirm: ConnectorConfirmParams, bridge = createFakeHostBridge()) {
  const onGone = vi.fn();
  const onRetry = vi.fn();
  const onWorking = vi.fn();
  render(
    <HostBridgeProvider bridge={bridge}>
      <InstallConfirm
        confirm={confirm}
        onGone={onGone}
        onTry={vi.fn()}
        onRetry={onRetry}
        onWorking={onWorking}
      />
    </HostBridgeProvider>,
  );
  return { bridge, onGone, onRetry, onWorking };
}

describe('InstallConfirm header status', () => {
  it('says Setting up for an app while it works, and nothing once it is done', async () => {
    const bridge = createFakeHostBridge();
    const { onWorking } = show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(onWorking).toHaveBeenCalledWith('Setting up Notion'));
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'connected', error: null, tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() => expect(onWorking).toHaveBeenLastCalledWith(null));
  });

  it('says Installing for an expert', async () => {
    const { onWorking } = show(EXPERT_ASK);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(onWorking).toHaveBeenCalledWith(expect.stringMatching(/^Installing /)),
    );
  });
});

describe('InstallConfirm done card prompts', () => {
  const connected = (id: string, name: string) =>
    [{ id, name, status: 'connected', error: null, tools: [] }] as never;

  it('offers the everyday job that needs the app, when there is one', async () => {
    const bridge = createFakeHostBridge();
    show(
      {
        ...APP_ASK,
        facts: { ...APP_ASK.facts, app: 'gmail' },
      } as unknown as ConnectorConfirmParams,
      bridge,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    bridge.apps = connected('gmail', 'Gmail');
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Draft replies to my inbox' })).toBeVisible(),
    );
  });

  it('shows no prompt chip for an app no everyday job needs', async () => {
    const bridge = createFakeHostBridge();
    show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    bridge.apps = connected('notion', 'Notion');
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() => expect(screen.getByText('Notion is ready.')).toBeVisible());
    expect(document.querySelector('.sc-try')).toBeNull();
  });
});

describe('InstallConfirm', () => {
  it('Allow approves once and the card moves to working, staying in place', async () => {
    const { bridge } = show(APP_ASK);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(bridge.approvals).toEqual([{ approvalId: 'a1', decision: 'once' }]));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('Not now denies and removes the card', async () => {
    const { bridge, onGone } = show(APP_ASK);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(onGone).toHaveBeenCalledOnce());
    expect(bridge.approvals).toEqual([{ approvalId: 'a1', decision: 'deny' }]);
  });

  it('an app that connects ends on Connected', async () => {
    const bridge = createFakeHostBridge();
    show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'connected', error: null, tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() => expect(screen.getByText('Notion is ready.')).toBeVisible());
  });

  it('a failed install keeps Try again and Not now', async () => {
    const bridge = createFakeHostBridge();
    const { onRetry } = show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'error', error: 'boom', tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Nothing was connected.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('Notion');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  it('keeps its whole card in view when it grows, as a failure adds its words', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const bridge = createFakeHostBridge();
    show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    scrollIntoView.mockClear();
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'error', error: 'boom', tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });

  it('an expert download shows its percent from the setup overview', async () => {
    const bridge = createFakeHostBridge();
    show(EXPERT_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(bridge.approvals).toHaveLength(1));
    bridge.setup = {
      progress: { expert: 'claude-acp', stage: 'downloading', percent: 40 },
    } as never;
    act(() => bridge.emitChanged('setup'));
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'),
    );
  });
});

describe('install card in the bubble', () => {
  it('one card per install, and it survives a dismiss and the turn ending', async () => {
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    const ask = { ...APP_ASK, type: 'connector.confirm', turnId: 't1' } as never;
    act(() => bridge.emit(ask));
    act(() => bridge.emit(ask));
    await waitFor(() =>
      expect(screen.getAllByRole('group', { name: 'Set up Notion' })).toHaveLength(1),
    );
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a1' } as never));
    act(() => bridge.emit({ type: 'turn.completed', turnId: 't1' } as never));
    expect(screen.getByRole('group', { name: 'Set up Notion' })).toBeVisible();
  });
});
