/**
 * Tests for LoopsPanel: the "Read my mail for loops" switch (off by default, one plain line when
 * on), the Held list with Forget, Stop and wipe behind an in-page confirm, and the "mail unread
 * since" line. Runs on the fake host bridge.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LoopRow, LoopsState } from '../shapes';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { LoopsPanel } from './loops-panel';

const LOOP: LoopRow = {
  id: 'a1',
  app: 'gmail',
  title: 'Send Priya the Q4 deck',
  asks: 'Wants the pricing slide updated',
  direction: 'i_owe',
  due: '2026-11-06T09:00:00+00:00',
  people: ['Priya'],
  status: 'held',
};
const WAITING: LoopRow = {
  ...LOOP,
  id: 'b2',
  title: 'Contract from Omar',
  asks: 'Signed copy',
  direction: 'they_owe',
  due: null,
  people: ['Omar', 'Lena'],
};

function open(state: Partial<LoopsState> = {}): FakeHostBridge {
  const bridge = createFakeHostBridge({
    loops: { apps: [{ id: 'gmail', name: 'Gmail', on: false }], loops: [], ...state },
  });
  render(
    <HostBridgeProvider bridge={bridge}>
      <LoopsPanel />
    </HostBridgeProvider>,
  );
  return bridge;
}

describe('LoopsPanel', () => {
  it('has the switch off by default and says nothing about mail leaving until it is on', async () => {
    open();
    const toggle = await screen.findByRole('switch', { name: 'Read my mail for loops (Gmail)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/goes to Anthropic/)).toBeNull();
  });

  it('turning it on calls the brain and shows one plain line about where mail goes', async () => {
    const bridge = open();
    fireEvent.click(await screen.findByRole('switch', { name: /Read my mail for loops/ }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['set gmail on']));
    expect(await screen.findByText(/goes to Anthropic to be read/)).toHaveTextContent(
      'stay on this computer',
    );
    expect(screen.getByRole('switch', { name: /Read my mail/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('lists held loops with title, asks, direction, due, people and status, and no body', async () => {
    open({ loops: [LOOP, WAITING] });
    const list = await screen.findByRole('list', { name: 'Held' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Send Priya the Q4 deck');
    expect(first).toHaveTextContent('Wants the pricing slide updated');
    expect(first).toHaveTextContent('You owe');
    expect(first).toHaveTextContent('Priya');
    expect(first).toHaveTextContent('Due Nov 6');
    expect(first).toHaveTextContent('Held');
    expect(second).toHaveTextContent('Waiting on them');
    expect(second).toHaveTextContent('Omar, Lena');
    expect(second).not.toHaveTextContent('Due');
  });

  it('says so when nothing is held', async () => {
    open();
    expect(await screen.findByText('Nothing is held.')).toBeInTheDocument();
  });

  it('forgets one loop and the list reads again', async () => {
    const bridge = open({ loops: [LOOP, WAITING] });
    const row = (await screen.findByText('Send Priya the Q4 deck')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Forget Send Priya the Q4 deck' }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['forget a1']));
    await waitFor(() => expect(screen.queryByText('Send Priya the Q4 deck')).toBeNull());
    expect(screen.getByText('Contract from Omar')).toBeInTheDocument();
  });

  it('asks before Stop and wipe, and Cancel changes nothing', async () => {
    const bridge = open({ loops: [LOOP] });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and wipe' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('deletes every held loop');
    expect(bridge.loopCalls).toEqual([]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bridge.loopCalls).toEqual([]);
  });

  it('wipes on Confirm: switch off, list empty', async () => {
    const bridge = open({
      apps: [{ id: 'gmail', name: 'Gmail', on: true }],
      loops: [LOOP],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and wipe' }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Wipe' }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['wipe']));
    expect(await screen.findByText('Nothing is held.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Read my mail/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows "mail unread since" only when the brain says mail stopped being read', async () => {
    const bridge = open({
      apps: [{ id: 'gmail', name: 'Gmail', on: true, unreadSince: '2026-11-04T09:30:00+00:00' }],
    });
    expect(await screen.findByText(/Mail unread since \d\d:\d\d/)).toBeInTheDocument();
    bridge.loops = { apps: [{ id: 'gmail', name: 'Gmail', on: true }], loops: [] };
    act(() => bridge.emitChanged('loops'));
    await waitFor(() => expect(screen.queryByText(/Mail unread since/)).toBeNull());
  });

  it('reads again when the brain says the loops changed', async () => {
    const bridge = open();
    await screen.findByText('Nothing is held.');
    bridge.loops = { ...bridge.loops, loops: [LOOP] };
    act(() => bridge.emitChanged('loops'));
    expect(await screen.findByText('Send Priya the Q4 deck')).toBeInTheDocument();
  });

  it('points to connecting a mail app when none is offered', async () => {
    open({ apps: [] });
    expect(await screen.findByText(/Connect Gmail/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
