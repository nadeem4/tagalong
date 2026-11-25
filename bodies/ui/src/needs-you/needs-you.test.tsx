/**
 * Tests for the remote-brain request UI: the bubble card, Home's section, the approved list on
 * Devices and the dock tag. Run against the fake host bridge.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { NeedsYouItem } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ApprovedOnThisPc } from './approved-list';
import { NeedsYouBubble } from './needs-you-card';
import { NeedsYouSection } from './needs-you-section';

afterEach(cleanup);

const ITEM: NeedsYouItem = {
  id: 'n1',
  need: 'approve',
  brain: 'mini-pc',
  identity: '4F2A-91C0',
  what: 'claude-agent-acp',
  path: 'C:\\tools\\claude-agent-acp.exe',
  state: 'waiting',
  bubble: true,
};

function shown(ui: React.ReactNode, options: Parameters<typeof createFakeHostBridge>[0]) {
  const bridge = createFakeHostBridge(options);
  render(<HostBridgeProvider bridge={bridge}>{ui}</HostBridgeProvider>);
  return bridge;
}

describe('NeedsYouBubble', () => {
  it('shows the path this PC resolved and runs nothing until Allow is clicked', async () => {
    const bridge = shown(<NeedsYouBubble />, { needsYou: [ITEM] });
    expect(await screen.findByText('C:\\tools\\claude-agent-acp.exe')).toBeTruthy();
    expect(screen.getByText(/mini-pc \(4F2A-91C0\)/)).toBeTruthy();
    expect(bridge.needsYouActs).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(bridge.needsYouActs).toEqual(['n1']);
    expect(await screen.findByText(/Allowed\. mini-pc can run claude-agent-acp/)).toBeTruthy();
  });

  it('says Sign in for a signed-out expert', async () => {
    shown(<NeedsYouBubble />, {
      needsYou: [{ ...ITEM, need: 'signin', expert: 'claude-code', path: null }],
    });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  describe('an app sign-in that finishes on this PC', () => {
    const SIGNIN: NeedsYouItem = {
      ...ITEM,
      id: 'a1',
      need: 'app_signin',
      what: 'Gmail',
      path: null,
    };

    it('says the sign-in is kept on the brain and offers to open the page again', async () => {
      const bridge = shown(<NeedsYouBubble />, { needsYou: [SIGNIN] });
      expect(await screen.findByText('Finish signing in to Gmail.')).toBeTruthy();
      expect(screen.getByText(/kept on mini-pc, not here/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Open it again' }));
      expect(bridge.needsYouActs).toEqual(['a1']);
    });

    it('is a plain card: names the app, opens first, and leaves out the yes-here line', async () => {
      shown(<NeedsYouBubble />, { needsYou: [SIGNIN] });
      expect(await screen.findByText('Waiting for Gmail.')).toBeTruthy();
      expect(screen.getByText(/Gmail's page opened in your browser/)).toBeTruthy();
      expect(screen.queryByText('How')).toBeNull();
      expect(screen.queryByText(/Only you can say yes/)).toBeNull();
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons).toEqual(['Open it again', 'Not now']);
    });

    it('after the brain refused, shows its reason in the alert with Not now only', async () => {
      shown(<NeedsYouBubble />, {
        needsYou: [
          { ...SIGNIN, state: 'failed', failure: 'The sign-in was refused.', canRetry: false },
        ],
      });
      expect((await screen.findByRole('alert')).textContent).toContain('The sign-in was refused.');
      expect(screen.queryByText(/page opened in your browser/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    });

    it('shows why it failed and offers Try again', async () => {
      shown(<NeedsYouBubble />, {
        needsYou: [
          {
            ...SIGNIN,
            state: 'failed',
            failure: 'Gmail sent you back, but mini-pc did not accept it.',
          },
        ],
      });
      expect((await screen.findByRole('alert')).textContent).toContain('did not accept it');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });

    it('says it is signed in on the brain once the brain has the code', async () => {
      shown(<NeedsYouBubble />, { needsYou: [{ ...SIGNIN, state: 'done' }] });
      expect(
        await screen.findByText('Gmail is signed in on mini-pc. You can close the browser tab.'),
      ).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  it('shows why a run failed and offers it again', async () => {
    shown(<NeedsYouBubble />, {
      needsYou: [{ ...ITEM, state: 'failed', failure: 'Access is denied.' }],
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Access is denied.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('NeedsYouSection', () => {
  it('lists every waiting request with a count, and nothing when there are none', async () => {
    shown(<NeedsYouSection items={[ITEM, { ...ITEM, id: 'n2', bubble: false, what: 'gh' }]} />, {});
    expect(await screen.findByText('2 waiting')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Allow' })).toHaveLength(2);
    cleanup();
    const { container } = render(<NeedsYouSection items={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('ApprovedOnThisPc', () => {
  it('asks before revoking, and revokes by key', async () => {
    const bridge = shown(<ApprovedOnThisPc />, {
      approved: [{ key: 'abc123', what: 'claude-agent-acp', path: 'C:\\tools\\a.exe' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(bridge.approved).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(bridge.approved).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(bridge.approved).toHaveLength(0));
    expect(await screen.findByText(/Nothing is approved yet/)).toBeTruthy();
  });
});
