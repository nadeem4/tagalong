/** Tests for the bubble's onAsk: text Home sends "as the person" is asked like typed text. */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

function sender() {
  let handler: ((text: string) => void) | null = null;
  const state = { unsubscribed: false };
  return {
    state,
    onAsk: (next: (text: string) => void) => {
      handler = next;
      return () => {
        state.unsubscribed = true;
      };
    },
    send: (text: string) => handler?.(text),
  };
}

function setup() {
  const bridge = createFakeHostBridge();
  const host = sender();
  const view = render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" onAsk={host.onAsk} />
    </HostBridgeProvider>,
  );
  return { bridge, host, view };
}

describe('CompanionBubble asked from Home', () => {
  it('submits text delivered through onAsk as the person, visibly', async () => {
    const { bridge, host } = setup();
    await act(async () => host.send('Fix text from pictures'));
    expect(bridge.asks).toEqual([{ petId: 'scout', text: 'Fix text from pictures' }]);
    expect(screen.getByText('Fix text from pictures')).toBeInTheDocument();
  });

  it('ignores empty ask text', async () => {
    const { bridge, host } = setup();
    await act(async () => host.send('   '));
    expect(bridge.asks).toEqual([]);
  });

  it('unsubscribes on unmount', () => {
    const { host, view } = setup();
    view.unmount();
    expect(host.state.unsubscribed).toBe(true);
  });
});
