/**
 * Tests for WaitingView: what waits, Allow once, Decline and Open, the live update, the empty
 * state, the words for each answered ask, the high-risk label and errors.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Ask } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { WaitingView } from './waiting-view';

const AT = '2026-10-22T10:42:00.000Z';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const WRITE: Ask = {
  id: id(1),
  kind: 'app-change',
  petId: 'scout',
  summary: 'Create a page\ntitle: Plan for Friday',
  risk: 'change',
  app: 'Notion',
  tool: 'create_page',
  state: 'waiting',
  createdAt: AT,
  expiresAt: '2026-10-22T11:42:00.000Z',
};
const CARD: Ask = {
  id: id(2),
  kind: 'handoff',
  petId: 'scout',
  summary: 'Fix the failing migration test',
  risk: 'change',
  expertName: 'Claude Code',
  state: 'waiting',
  createdAt: AT,
  expiresAt: '2026-10-23T10:42:00.000Z',
};

function answered(n: number, state: Ask['state'], note?: Ask['note']): Ask {
  return {
    ...WRITE,
    id: id(n),
    summary: 'Create a page',
    state,
    ...(state === 'approved' || state === 'declined' ? { answeredBy: 'you' as const } : {}),
    ...(note === undefined ? {} : { note }),
    answeredAt: AT,
  };
}

function renderWaiting(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <WaitingView />
    </HostBridgeProvider>,
  );
}

const waiting = () => screen.getByRole('region', { name: 'Waiting' });
const answeredList = () => screen.findByRole('region', { name: 'Answered' });

describe('WaitingView', () => {
  it('lists what waits: which app, the tool, the change in full and when it ends', async () => {
    renderWaiting(createFakeHostBridge({ savedAsks: [WRITE, CARD] }));
    const row = await within(waiting()).findByRole('listitem', { name: /Notion/ });
    expect(row).toHaveTextContent('Change in Notion · create_page · Changes something');
    expect(row).toHaveTextContent('Create a page');
    expect(row).toHaveTextContent('title: Plan for Friday');
    expect(row).toHaveTextContent(/Asked .* · ends /);
    const card = within(waiting()).getByRole('listitem', { name: /Claude Code/ });
    expect(card).toHaveTextContent('Hand to Claude Code · Changes something');
    expect(card).toHaveTextContent('Fix the failing migration test');
  });

  it('Allow once and Decline answer the ask', async () => {
    const bridge = createFakeHostBridge({ savedAsks: [WRITE, { ...WRITE, id: id(3) }] });
    renderWaiting(bridge);
    const [first, second] = await within(waiting()).findAllByRole('listitem');
    await act(async () =>
      fireEvent.click(within(first!).getByRole('button', { name: 'Allow once' })),
    );
    await act(async () =>
      fireEvent.click(within(second!).getByRole('button', { name: 'Decline' })),
    );
    expect(bridge.answeredAsks).toEqual([
      { id: id(1), decision: 'approve' },
      { id: id(3), decision: 'decline' },
    ]);
  });

  it('a hand-off shows Open, which raises its card, and Decline; never Allow once', async () => {
    const bridge = createFakeHostBridge({ savedAsks: [CARD] });
    renderWaiting(bridge);
    const card = await within(waiting()).findByRole('listitem');
    expect(within(card).queryByRole('button', { name: 'Allow once' })).toBeNull();
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Open' })));
    expect(bridge.openedAsks).toEqual([id(2)]);
  });

  it('follows asks.changed: an ask answered elsewhere goes', async () => {
    const bridge = createFakeHostBridge({ savedAsks: [WRITE] });
    renderWaiting(bridge);
    await within(waiting()).findByRole('listitem');
    bridge.savedAsks = [answered(1, 'approved')];
    await act(async () => bridge.emit({ type: 'asks.changed', waiting: [] }));
    expect(await within(waiting()).findByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(within(await answeredList()).getByRole('listitem')).toHaveTextContent('Approved by you');
  });

  it('says plainly when nothing waits', async () => {
    renderWaiting(createFakeHostBridge());
    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
  });

  it('says how each answered ask ended, and that nothing changed unless approved', async () => {
    renderWaiting(
      createFakeHostBridge({
        savedAsks: [
          answered(11, 'approved'),
          answered(12, 'declined'),
          answered(13, 'expired', 'expired'),
          answered(14, 'expired', 'closed'),
          answered(15, 'cancelled', 'turn-ended'),
          answered(16, 'cancelled', 'expert-unavailable'),
        ],
      }),
    );
    const rows = await within(await answeredList()).findAllByRole('listitem');
    const words = rows.map((row) => row.textContent ?? '');
    expect(words[0]).toContain('Approved by you');
    expect(words[0]).not.toContain('Nothing was changed.');
    expect(words[1]).toContain('Declined by you. Nothing was changed.');
    expect(words[2]).toContain('Expired: no answer in time. Nothing was changed.');
    expect(words[3]).toContain('Expired: Tagalong closed first. Nothing was changed.');
    expect(words[4]).toContain('Cancelled: the conversation was stopped. Nothing was changed.');
    expect(words[5]).toContain('Cancelled: expert no longer available. Nothing was changed.');
  });

  it('labels a change that cannot be undone', async () => {
    renderWaiting(
      createFakeHostBridge({ savedAsks: [{ ...WRITE, risk: 'high', tool: 'delete_page' }] }),
    );
    const row = await within(waiting()).findByRole('listitem');
    expect(row).toHaveTextContent('Change in Notion · delete_page · Can’t be undone');
    expect(row).not.toHaveTextContent('Changes something');
  });

  it('shows a failed answer as an alert', async () => {
    renderWaiting(createFakeHostBridge({ savedAsks: [WRITE], answerAskFails: true }));
    const row = await within(waiting()).findByRole('listitem');
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Allow once' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('engine restarting');
  });
});
