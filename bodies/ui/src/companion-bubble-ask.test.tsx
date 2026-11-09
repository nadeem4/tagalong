/** Tests for the bubble's onAsk: text Home sends "as the person" is asked like typed text. */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { ruleOf } from './test-support/css-rules';
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

describe('CompanionBubble mounted while an ask is open', () => {
  it('shows the open ask the body kept, though its live event came before the bubble existed', async () => {
    const bridge = createFakeHostBridge({
      openConfirms: [
        {
          type: 'connector.confirm',
          approvalId: 'a1',
          turnId: '',
          petId: 'scout',
          app: 'Claude Code',
          tool: 'hand_off',
          summary: 'Write ten poems',
          options: ['Manual', 'Plan', 'cancel'],
        },
      ],
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" />
      </HostBridgeProvider>,
    );
    expect(await screen.findByText(/Write ten poems/)).toBeInTheDocument();
  });

  // A folder path has no spaces to break at; without this it ran past the card's edge.
  it('wraps a long unbroken path in the card text instead of clipping it', async () => {
    const bridge = createFakeHostBridge({
      openConfirms: [
        {
          type: 'connector.confirm',
          approvalId: 'a1',
          turnId: '',
          petId: 'scout',
          app: 'Claude Code',
          tool: 'hand_off',
          summary:
            'folder: C:/Users/someone/AppData/Local/Temp/a-very-long-folder-name-with-no-spaces',
          options: ['Manual', 'cancel'],
        },
      ],
    });
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" />
      </HostBridgeProvider>,
    );
    await screen.findByText(/folder:/);
    const css = [...container.querySelectorAll('style')].map((s) => s.textContent).join(' ');
    expect(ruleOf(css, '.bubble-text')).toContain('overflow-wrap: anywhere');
  });
});

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
