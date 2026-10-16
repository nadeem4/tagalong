/** Tests for ChatPanel: Look and Clear, asking, streaming, errors and follow-ups. */

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

const screenshot: ContextSnapshot = {
  id: '22222222-2222-4222-8222-222222222222',
  capturedAt: '2026-09-11T10:05:00.000Z',
  host: 'desktop',
  app: { name: 'chrome.exe', windowTitle: 'Zod 4 changelog' },
  screenshot: { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 1280, height: 800 },
};

function renderPanel(bridge: FakeHostBridge, attached: ContextSnapshot | null = snapshot) {
  return render(
    <HostBridgeProvider bridge={bridge}>
      <ChatPanel petId="sage" {...(attached === null ? {} : { snapshot: attached })} />
    </HostBridgeProvider>,
  );
}

function look(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Look at screen' }));
}

function send(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
}

describe('ChatPanel', () => {
  it('shows the sight bar naming what will be attached', () => {
    renderPanel(createFakeHostBridge());

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveAttribute('data-state', 'seeing');
    expect(bar).toHaveTextContent('42 chars');
    expect(bar).toHaveTextContent('Code.exe');
  });

  it('says it is not seeing anything when the host captured nothing', () => {
    renderPanel(createFakeHostBridge(), null);

    expect(screen.getByTestId('sight-bar')).toHaveAttribute('data-state', 'blind');
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask anything — or attach what you are looking at',
    );
  });

  it('attaches a screenshot to the next ask when Look is clicked', async () => {
    const bridge = createFakeHostBridge({ capture: screenshot });
    renderPanel(bridge, null);

    look();

    expect(bridge.captures).toEqual([['screenshot', 'activeWindow']]);
    await waitFor(() => expect(screen.getByTestId('sight-thumbnail')).toBeInTheDocument());
    expect(screen.getByTestId('sight-bar')).toHaveTextContent('chrome.exe');

    send('What is wrong here?');

    expect(bridge.asks).toEqual([
      { petId: 'sage', text: 'What is wrong here?', snapshot: screenshot },
    ]);
  });

  it('captures what the host says Look means, under the label it gives', async () => {
    const page: ContextSnapshot = {
      id: '33333333-3333-4333-8333-333333333333',
      capturedAt: '2026-09-11T10:06:00.000Z',
      host: 'extension',
      page: { url: 'https://example.com/', title: 'Example', text: 'Body text.' },
    };
    const bridge = createFakeHostBridge({ capture: page });
    render(
      <HostBridgeProvider bridge={bridge}>
        <ChatPanel
          petId="sage"
          lookTargets={['selection', 'pageText', 'activeWindow']}
          lookLabel="Read this page"
        />
      </HostBridgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Read this page' }));

    expect(bridge.captures).toEqual([['selection', 'pageText', 'activeWindow']]);
    await waitFor(() =>
      expect(screen.getByTestId('sight-bar')).toHaveTextContent('page “Example”'),
    );
  });

  it('says capture is blocked here when the host refuses', async () => {
    const bridge = createFakeHostBridge({ capture: null });
    renderPanel(bridge, null);

    look();

    await waitFor(() =>
      expect(screen.getByTestId('sight-bar')).toHaveAttribute('data-state', 'blocked'),
    );
    expect(screen.getByTestId('sight-bar')).toHaveTextContent('Capture is blocked here');
  });

  it('drops the attached context when the remove control is used', () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('sight-bar')).toHaveAttribute('data-state', 'blind');

    send('Explain this');

    expect(bridge.asks).toEqual([{ petId: 'sage', text: 'Explain this' }]);
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
