/** Tests for ChatPanel's watches: the Watching chip, Stop and fired-watch cards. */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { ChatPanel } from './chat-panel';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'anthropic/claude-sonnet-5',
  providerId: 'openrouter',
  roleId: 'generalist',
};

const W1 = '30000000-0000-4000-8000-000000000001';
const W2 = '30000000-0000-4000-8000-000000000002';

function renderPanel(): FakeHostBridge {
  const bridge = createFakeHostBridge({ pets: [scout] });
  render(
    <HostBridgeProvider bridge={bridge}>
      <ChatPanel pet={scout} />
    </HostBridgeProvider>,
  );
  return bridge;
}

function status(
  bridge: FakeHostBridge,
  watchId: string,
  state: 'watching' | 'fired' | 'stopped' | 'timeout' | 'capped' | 'error',
  extra: { checks?: number; detail?: string; condition?: string } = {},
): void {
  act(() => {
    bridge.emit({
      type: 'watch.status',
      watchId,
      petId: 'scout',
      condition: extra.condition ?? 'the build finishes',
      displayId: 1,
      state,
      checks: extra.checks ?? 0,
      maxChecks: 60,
      checkModel: 'anthropic/claude-haiku-4.5',
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    });
  });
}

describe('the Watching chip', () => {
  it('appears while a watch runs, naming the condition and the checks spent', () => {
    const bridge = renderPanel();
    expect(screen.queryByTestId('watching')).toBeNull();

    status(bridge, W1, 'watching', { checks: 2 });
    const chip = screen.getByTestId('watching');
    expect(chip).toHaveTextContent('Watching');
    expect(chip).toHaveTextContent('the build finishes');
    expect(chip).toHaveTextContent('2/60');
    // Which model answers the checks is part of what the chip says: it is the cost story.
    expect(chip).toHaveTextContent('anthropic/claude-haiku-4.5');
  });

  it('shows one chip per watch', () => {
    const bridge = renderPanel();
    status(bridge, W1, 'watching');
    status(bridge, W2, 'watching', { condition: 'the download completes' });
    expect(screen.getAllByTestId('watching')).toHaveLength(2);
  });

  it('Stop asks the host to end that watch', () => {
    const bridge = renderPanel();
    status(bridge, W1, 'watching');
    fireEvent.click(within(screen.getByTestId('watching')).getByRole('button', { name: /stop/i }));
    expect(bridge.stoppedWatches).toEqual([W1]);
  });

  it('goes away when the watch ends', () => {
    const bridge = renderPanel();
    status(bridge, W1, 'watching');
    status(bridge, W1, 'stopped');
    expect(screen.queryByTestId('watching')).toBeNull();
  });

  it('says why a watch ended on its own, without having fired', () => {
    const bridge = renderPanel();
    status(bridge, W1, 'watching');
    status(bridge, W1, 'timeout', { detail: 'Nothing matched before the timeout.' });
    expect(screen.getByRole('log')).toHaveTextContent('Nothing matched before the timeout.');
  });
});

describe('a fired watch', () => {
  it('shows the message from the pet that was watching', () => {
    const bridge = renderPanel();
    status(bridge, W1, 'watching');
    act(() => {
      bridge.emit({
        type: 'watch.fired',
        watchId: W1,
        petId: 'scout',
        message: 'The terminal shows Build succeeded.',
        displayId: 1,
      });
    });
    status(bridge, W1, 'fired');

    const fired = screen.getByTestId('watch-fired');
    expect(fired).toHaveTextContent('The terminal shows Build succeeded.');
    expect(fired).toHaveTextContent('Scout');
    expect(fired).toHaveTextContent('the build finishes');
    expect(screen.queryByTestId('watching')).toBeNull();
  });
});
