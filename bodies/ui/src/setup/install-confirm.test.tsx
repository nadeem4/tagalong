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
  it('a row that was already in error does not fail a fresh Allow, only a new error does', async () => {
    const bridge = createFakeHostBridge();
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'error', error: 'old', tools: [] },
    ] as never;
    show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    expect(screen.queryByRole('alert')).toBeNull();
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'needs-sign-in', error: '', tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() => expect(screen.getByText('Your browser opened to sign in.')).toBeVisible());
    bridge.apps = [
      { id: 'notion', name: 'Notion', status: 'error', error: 'old', tools: [] },
    ] as never;
    act(() => bridge.emit({ type: 'connections.changed' } as never));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Notion didn't finish signing in. Nothing was connected.",
      ),
    );
  });

  it('Not now drops the card even when the brain refuses the answer, never leaving a live Allow', async () => {
    const bridge = createFakeHostBridge();
    bridge.approveTool = () => Promise.reject(new Error('gone'));
    const { onGone } = show(APP_ASK, bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(onGone).toHaveBeenCalledOnce());
  });

  it('a retry that fails with the same error text still ends on the failure, not on Checking it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bridge = createFakeHostBridge();
      bridge.apps = [
        { id: 'notion', name: 'Notion', status: 'error', error: 'same', tools: [] },
      ] as never;
      show(APP_ASK, bridge);
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
      await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(screen.getByRole('alert')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

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
    expect(screen.getByText("Into Tagalong's own folder, about 60 MB")).toBeVisible();
  });
});

describe('install card in the bubble', () => {
  function bubble(bridge = createFakeHostBridge()) {
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    return bridge;
  }
  const ask = (over: object = {}) =>
    ({ ...APP_ASK, type: 'connector.confirm', turnId: 't1', ...over }) as never;

  it('one card per install, and an Allowed one survives a dismiss and the turn ending', async () => {
    const bridge = bubble();
    act(() => bridge.emit(ask()));
    act(() => bridge.emit(ask()));
    await waitFor(() =>
      expect(screen.getAllByRole('group', { name: 'Set up Notion' })).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a1' } as never));
    act(() => bridge.emit({ type: 'turn.completed', turnId: 't1' } as never));
    expect(screen.getByRole('group', { name: 'Set up Notion' })).toBeVisible();
  });

  it('the card sits under the same Scout reply as its sentence, not in a row of its own', async () => {
    const bridge = bubble();
    fireEvent.change(screen.getByLabelText('Message Scout'), {
      target: { value: 'Connect my Notion' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bridge.asks).toHaveLength(1));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 't1',
        petId: 'scout',
        conversationId: '10000000-0000-4000-8000-0000000000c1',
      } as never);
      bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'Sure, here is Notion.' } as never);
      bridge.emit(ask());
    });
    const group = await screen.findByRole('group', { name: 'Set up Notion' });
    expect(group.closest('.bubble-scout')).toHaveTextContent('Sure, here is Notion.');
    expect(document.querySelectorAll('.bubble-scout')).toHaveLength(1);
  });

  it('a closed ask drops its card while it is still asking, so no live Allow stays', async () => {
    const bridge = bubble();
    act(() => bridge.emit(ask()));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).toBeVisible());
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a1' } as never));
    expect(screen.queryByRole('group', { name: 'Set up Notion' })).toBeNull();
  });

  it('a repeat ask for the same install replaces its card with a fresh one', async () => {
    const bridge = bubble();
    act(() => bridge.emit(ask()));
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible());
    act(() => bridge.emit(ask({ approvalId: 'a9' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).toBeVisible());
    expect(screen.getAllByRole('group', { name: 'Set up Notion' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(bridge.approvals).toEqual([
        { approvalId: 'a1', decision: 'once' },
        { approvalId: 'a9', decision: 'once' },
      ]),
    );
  });
});
