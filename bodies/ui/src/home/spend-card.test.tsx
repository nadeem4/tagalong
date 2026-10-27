/** Tests for SpendCard: today's spend and the daily limit, as the brain reports them. */

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, type SpendToday } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { SpendCard } from './spend-card';

function renderCard(read: () => SpendToday) {
  let reads = 0;
  const bridge = Object.assign(createFakeHostBridge(), {
    usageSummary: () => {
      reads += 1;
      return Promise.resolve(read());
    },
  });
  render(
    <HostBridgeProvider bridge={bridge}>
      <SpendCard />
    </HostBridgeProvider>,
  );
  return { bridge, reads: () => reads };
}

describe('SpendCard', () => {
  it('shows today’s spend against the daily limit', async () => {
    renderCard(() => ({ spentUsd: 0.31, limitUsd: 1 }));
    await waitFor(() => expect(screen.getByText('$0.31 of $1')).toBeInTheDocument());
    expect(screen.queryByText(/paused/)).not.toBeInTheDocument();
  });

  it('shows the spend alone when there is no limit', async () => {
    renderCard(() => ({ spentUsd: 2.5, limitUsd: null }));
    await waitFor(() => expect(screen.getByText('$2.50')).toBeInTheDocument());
  });

  it('says when nothing is spent yet', async () => {
    renderCard(() => ({ spentUsd: 0, limitUsd: 1 }));
    await waitFor(() => expect(screen.getByText('Nothing spent yet today.')).toBeInTheDocument());
  });

  it('shows a sub-cent spend as under one cent', async () => {
    renderCard(() => ({ spentUsd: 0.004, limitUsd: 1 }));
    await waitFor(() => expect(screen.getByText('under $0.01 of $1')).toBeInTheDocument());
  });

  it('says proactive comments are paused once today’s limit is spent', async () => {
    renderCard(() => ({ spentUsd: 1.02, limitUsd: 1 }));
    await waitFor(() =>
      expect(
        screen.getByText('Proactive comments paused: today’s $1 is spent.'),
      ).toBeInTheDocument(),
    );
  });

  it('reads again when a turn, hand-off or routine finishes', async () => {
    const { bridge, reads } = renderCard(() => ({ spentUsd: 0, limitUsd: 1 }));
    await waitFor(() => expect(reads()).toBe(1));
    act(() => bridge.emit({ type: 'turn.delta', turnId: 't', delta: 'x' } as never));
    expect(reads()).toBe(1);
    act(() => bridge.emit({ type: 'turn.completed', turnId: 't' } as never));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it('shows nothing on a host that cannot read spend, and survives a failed read', async () => {
    const bridge = Object.assign(createFakeHostBridge(), {
      usageSummary: () => Promise.reject(new Error('brain down')),
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <SpendCard />
      </HostBridgeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('Tagalong could not read what was spent.')).toBeInTheDocument(),
    );
  });

  it('renders nothing when the host has no spend', () => {
    const bridge = createFakeHostBridge();
    delete bridge.usageSummary;
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <SpendCard />
      </HostBridgeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
