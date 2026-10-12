import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const SNAPSHOT: ContextSnapshot = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  capturedAt: '2026-10-12T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code', windowTitle: 'engine.test.ts - ai_pet - Visual Studio Code' },
  selection: 'shuts down while a turn is running',
};

const CONVERSATION = '10000000-0000-4000-8000-0000000000c1';

function renderBubble(
  bridge: FakeHostBridge,
  props: Partial<Parameters<typeof CompanionBubble>[0]> = {},
) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" {...props} />
    </HostBridgeProvider>,
  );
}

const done = (turnId: string, text: string) =>
  ({
    type: 'turn.completed',
    turnId,
    text,
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
  }) as const;

const ask = (text: string) => {
  const input = screen.getByLabelText('Ask Scout');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('CompanionBubble', () => {
  it('greets once after Welcome: where it is, the key to press, and Got it', () => {
    const onDismiss = vi.fn();
    renderBubble(createFakeHostBridge(), {
      greeting: true,
      hotkeyLabel: 'Ctrl+Shift+Space',
      onDismiss,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'I’m here. Press Ctrl+Shift+Space whenever you want me, or click me.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows what it can see as chips, and asks with that context on Enter', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    expect(screen.getByText('Code · engine.test.ts - ai_pet - Visual Studio Code')).toBeVisible();
    expect(screen.getByText('Selected text')).toBeVisible();

    await act(async () => ask('why does this test fail?'));

    expect(bridge.asks).toEqual([
      { petId: 'scout', text: 'why does this test fail?', snapshot: SNAPSHOT },
    ]);
  });

  it('leaves out what the person removed', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    fireEvent.click(screen.getByRole('button', { name: 'Do not send Selected text' }));
    await act(async () => ask('what is this?'));
    const { selection: _gone, ...rest } = SNAPSHOT;
    expect(bridge.asks[0]?.snapshot).toEqual(rest);
  });

  it('streams the answer into the bubble, with Stop while it runs', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'Because the ' });
    });
    expect(screen.getByText(/Because the/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(bridge.interrupts).toEqual(['turn-1']);

    act(() => bridge.emit(done('turn-1', 'Because the database closed first.')));
    expect(screen.getByText('Because the database closed first.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('continues the same conversation on the next question', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('first'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'One.'));
    });
    await act(async () => ask('second'));
    expect(bridge.asks[1]).toEqual({
      petId: 'scout',
      conversationId: CONVERSATION,
      text: 'second',
    });
  });

  it('says plainly when the answer fails', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({
        type: 'turn.error',
        turnId: 'turn-1',
        code: 'auth',
        message: 'Claude Code could not answer: Please run /login',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Please run /login');
  });

  it('ignores turns of other pets', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'x',
        petId: 'ink',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('x', 'Ink talking.'));
    });
    expect(screen.queryByText('Ink talking.')).toBeNull();
  });

  it('opens the full chat on request', () => {
    const onOpenChat = vi.fn();
    renderBubble(createFakeHostBridge(), { onOpenChat });
    fireEvent.click(screen.getByRole('button', { name: 'Open full chat' }));
    expect(onOpenChat).toHaveBeenCalledOnce();
  });
});

describe('CompanionBubble, expanded into the full chat', () => {
  async function twoExchanges(bridge: FakeHostBridge) {
    await act(async () => ask('first question'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'First answer.'));
    });
    await act(async () => ask('second question'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-2',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-2', 'Second answer.'));
    });
  }

  it('shows only the latest exchange as a bubble', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await twoExchanges(bridge);
    expect(screen.queryByText('First answer.')).toBeNull();
    expect(screen.getByText('Second answer.')).toBeVisible();
  });

  it('shows the whole conversation when expanded, with a way back to the bubble', async () => {
    const bridge = createFakeHostBridge();
    const onCollapse = vi.fn();
    const { rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onOpenChat={() => undefined} />
      </HostBridgeProvider>,
    );
    await twoExchanges(bridge);
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded onCollapse={onCollapse} />
      </HostBridgeProvider>,
    );
    const thread = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(thread.textContent).toMatch(
      /first question.*First answer\..*second question.*Second answer\./,
    );
    expect(screen.getByLabelText('Message Scout')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to bubble' }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});

describe('CompanionBubble, attached to the pet', () => {
  it('closes from its × button, in the bubble and in the full chat', () => {
    const onClose = vi.fn();
    const bridge = createFakeHostBridge();
    const { rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onClose={onClose} />
      </HostBridgeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded onClose={onClose} />
      </HostBridgeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('points its tail at the pet, on whichever side the pet is', () => {
    const bridge = createFakeHostBridge();
    const { container, rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" tail="right" />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('[data-tail]')).toHaveAttribute('data-tail', 'right');
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" tail="left" greeting />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('[data-tail]')).toHaveAttribute('data-tail', 'left');
  });
});
