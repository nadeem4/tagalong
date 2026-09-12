import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { ChatPanel } from './chat-panel';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const snapshot: ContextSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-09-11T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code.exe', windowTitle: 'README.md - ai_pet' },
  selection: 'x'.repeat(42),
};

function renderPanel(bridge: FakeHostBridge) {
  return render(
    <HostBridgeProvider bridge={bridge}>
      <ChatPanel petId="sage" snapshot={snapshot} />
    </HostBridgeProvider>,
  );
}

function send(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
}

describe('ChatPanel', () => {
  it('shows the context chip for what will be attached', () => {
    renderPanel(createFakeHostBridge());

    expect(screen.getByTestId('context-chip')).toHaveTextContent('42 chars selected');
  });

  it('asks through the bridge with the pet, text and snapshot, and echoes the question', () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);

    send('Explain this');

    expect(bridge.asks).toEqual([{ petId: 'sage', text: 'Explain this', snapshot }]);
    expect(screen.getByText('Explain this')).toHaveAttribute('data-role', 'user');
  });

  it('grows the visible answer as turn.delta events arrive and settles on turn.completed', () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    send('Explain this');

    act(() => {
      bridge.emit({ type: 'turn.started', turnId: 't1', petId: 'sage', conversationId: 'c1' });
    });
    expect(screen.queryByTestId('streaming-message')).not.toBeInTheDocument();

    act(() => bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'A fox' }));
    expect(screen.getByTestId('streaming-message')).toHaveTextContent('A fox');

    act(() => bridge.emit({ type: 'turn.delta', turnId: 't1', text: ' is a' }));
    expect(screen.getByTestId('streaming-message')).toHaveTextContent('A fox is a');

    act(() => bridge.emit({ type: 'turn.delta', turnId: 't1', text: ' small canid.' }));
    expect(screen.getByTestId('streaming-message')).toHaveTextContent('A fox is a small canid.');

    act(() => {
      bridge.emit({
        type: 'turn.completed',
        turnId: 't1',
        text: 'A fox is a small canid.',
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 20 },
      });
    });

    expect(screen.queryByTestId('streaming-message')).not.toBeInTheDocument();
    expect(screen.getByText('A fox is a small canid.')).toHaveAttribute('data-role', 'assistant');
  });

  it('locks the composer while a turn streams and frees it when the turn completes', () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    send('Explain this');

    act(() => {
      bridge.emit({ type: 'turn.started', turnId: 't1', petId: 'sage', conversationId: 'c1' });
    });
    expect(screen.getByRole('textbox')).toBeDisabled();

    act(() => {
      bridge.emit({
        type: 'turn.completed',
        turnId: 't1',
        text: 'Done.',
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    });
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('shows a turn error instead of leaving the panel stuck streaming', () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    send('Explain this');

    act(() => {
      bridge.emit({ type: 'turn.started', turnId: 't1', petId: 'sage', conversationId: 'c1' });
      bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'partial' });
      bridge.emit({
        type: 'turn.error',
        turnId: 't1',
        code: 'rate_limit',
        message: 'Rate limited.',
      });
    });

    expect(screen.getByText('Rate limited.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('reports a bridge that refuses the ask rather than rejecting into the void', async () => {
    const bridge: FakeHostBridge = {
      ...createFakeHostBridge(),
      ask: () => Promise.reject(new Error('engine offline')),
    };
    renderPanel(bridge);

    send('Explain this');

    await waitFor(() => expect(screen.getByText(/engine offline/)).toBeInTheDocument());
  });
});
