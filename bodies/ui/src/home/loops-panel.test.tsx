/**
 * Tests for LoopsPanel: the "Read my mail for loops" switch (off by default, one plain line when
 * on), the Held list with Forget, Stop and wipe behind an in-page confirm, and the "mail unread
 * since" line. Runs on the fake host bridge.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.useRealTimers();
});

describe('LoopsPanel', () => {
  it('has the switch off by default and says where mail goes before it is turned on', async () => {
    open();
    const toggle = await screen.findByRole('switch', { name: 'Read my mail for loops (Gmail)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/goes to Anthropic to be read/)).toHaveTextContent(
      'stay on this computer',
    );
  });

  it('turning it on calls the brain and flips the switch', async () => {
    const bridge = open();
    fireEvent.click(await screen.findByRole('switch', { name: /Read my mail for loops/ }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['set gmail on']));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Read my mail/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
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
    expect(screen.getByRole('button', { name: 'Stop and wipe' })).toHaveFocus();
  });

  it('Escape also closes the confirm and returns focus to Stop and wipe', async () => {
    open({ loops: [LOOP] });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and wipe' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop and wipe' })).toHaveFocus();
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

  it('reads again when an app connects while Home is open', async () => {
    const bridge = open({ apps: [] });
    await screen.findByText(/Connect Gmail/);
    bridge.loops = { ...bridge.loops, apps: [{ id: 'gmail', name: 'Gmail', on: false }] };
    act(() => bridge.emitChanged('apps'));
    expect(await screen.findByRole('switch', { name: /Gmail/ })).toBeInTheDocument();
  });

  it('counts only open loops in Held, not done or dropped ones', async () => {
    open({
      loops: [LOOP, { ...WAITING, status: 'done' }, { ...WAITING, id: 'c3', status: 'dropped' }],
    });
    expect(await screen.findByRole('heading', { name: 'Held (1)' })).toBeInTheDocument();
  });

  it('points to connecting a mail app when none is offered', async () => {
    open({ apps: [] });
    expect(await screen.findByText(/Connect Gmail/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('gives an open row Done and Later, and a closed row neither', async () => {
    open({ loops: [LOOP, { ...WAITING, status: 'done' }] });
    const open1 = (await screen.findByText('Send Priya the Q4 deck')).closest('li') as HTMLElement;
    expect(
      within(open1).getByRole('button', { name: 'Done Send Priya the Q4 deck' }),
    ).toBeVisible();
    expect(
      within(open1).getByRole('button', { name: 'Later Send Priya the Q4 deck' }),
    ).toBeVisible();
    const closed = screen.getByText('Contract from Omar').closest('li') as HTMLElement;
    expect(within(closed).queryByRole('button', { name: /^Done / })).toBeNull();
    expect(within(closed).queryByRole('button', { name: /^Later / })).toBeNull();
  });

  it('Done closes the loop and the list reads again', async () => {
    const bridge = open({ loops: [LOOP] });
    fireEvent.click(await screen.findByRole('button', { name: 'Done Send Priya the Q4 deck' }));
    await waitFor(() => expect(bridge.loopCalls).toEqual(['done a1']));
  });

  it('Later sends tomorrow at nine, local, with the offset', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 10, 15, 0) });
    const bridge = open({ loops: [LOOP] });
    fireEvent.click(await screen.findByRole('button', { name: 'Later Send Priya the Q4 deck' }));
    await waitFor(() => expect(bridge.loopCalls).toHaveLength(1));
    const [call] = bridge.loopCalls;
    const until = (call as string).replace('later a1 ', '');
    expect(until).toMatch(/[+-]\d\d:\d\d$|Z$/);
    expect(new Date(until).getTime()).toBe(new Date(2026, 10, 11, 9, 0).getTime());
  });
});
