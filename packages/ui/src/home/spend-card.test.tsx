import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UsageRow, UsageSummaryResult } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { SpendCard, formatSpend } from './spend-card';

const row = (over: Partial<UsageRow>): UsageRow => ({
  source: 'scout',
  providerId: 'openrouter',
  model: 'anthropic/claude-haiku-4.5',
  inputTokens: 0,
  outputTokens: 0,
  costUsd: null,
  unpricedTokens: 0,
  ...over,
});

const summary = (over: Partial<UsageSummaryResult> = {}): UsageSummaryResult => ({
  today: [],
  month: [],
  todayUsd: 0,
  budget: { dailyUsd: null, spentOut: false },
  ...over,
});

function renderCard(read: () => UsageSummaryResult) {
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

describe('formatSpend', () => {
  it('shows dollars for a priced row', () => {
    expect(formatSpend(row({ costUsd: 0.31, inputTokens: 90_000, outputTokens: 2000 }))).toBe(
      '$0.31',
    );
    expect(formatSpend(row({ costUsd: 0.004 }))).toBe('under $0.01');
  });

  it('shows tokens and "price unknown" when the model has no price, never a guess', () => {
    expect(
      formatSpend(row({ inputTokens: 11_000, outputTokens: 1000, unpricedTokens: 12_000 })),
    ).toBe('12k tokens · price unknown');
    expect(formatSpend(row({ costUsd: 0.2, inputTokens: 20_000, unpricedTokens: 3_000_000 }))).toBe(
      '$0.20 + 3.0M tokens · price unknown',
    );
  });

  it('shows the Claude sign-in as tokens on your plan, never as dollars', () => {
    expect(
      formatSpend(
        row({
          providerId: 'claude-code',
          inputTokens: 40_000,
          outputTokens: 8000,
          unpricedTokens: 48_000,
        }),
      ),
    ).toBe('48k tokens (your plan)');
  });
});

describe('SpendCard', () => {
  it('lists today and this month by who spent it and where', async () => {
    renderCard(() =>
      summary({
        today: [
          row({ costUsd: 0.31 }),
          row({ providerId: 'claude-code', inputTokens: 48_000, unpricedTokens: 48_000 }),
        ],
        month: [
          row({
            source: 'expert',
            providerId: 'claude-code',
            inputTokens: 210_000,
            unpricedTokens: 210_000,
          }),
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText('Scout · OpenRouter')).toBeInTheDocument());
    expect(screen.getByText('$0.31')).toBeInTheDocument();
    expect(screen.getByText('Scout · Claude sign-in')).toBeInTheDocument();
    expect(screen.getByText('48k tokens (your plan)')).toBeInTheDocument();
    expect(screen.getByText('Experts · Claude Code')).toBeInTheDocument();
    expect(screen.getByText('210k tokens (your plan)')).toBeInTheDocument();
    expect(screen.queryByText(/paused/)).not.toBeInTheDocument();
  });

  it('says when nothing is spent yet', async () => {
    renderCard(() => summary());
    await waitFor(() => expect(screen.getByText('Nothing spent yet today.')).toBeInTheDocument());
  });

  it('says proactive comments are paused once today’s budget is spent', async () => {
    renderCard(() =>
      summary({
        today: [row({ costUsd: 1.02 })],
        todayUsd: 1.02,
        budget: { dailyUsd: 1, spentOut: true },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Proactive comments paused: today’s $1 is spent.'),
      ).toBeInTheDocument(),
    );
  });

  it('reads again when a turn, hand-off or routine finishes', async () => {
    const { bridge, reads } = renderCard(() => summary());
    await waitFor(() => expect(reads()).toBe(1));
    act(() => bridge.emit({ type: 'turn.delta', turnId: 't', delta: 'x' } as never));
    expect(reads()).toBe(1);
    act(() => bridge.emit({ type: 'turn.completed', turnId: 't' } as never));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it('shows nothing on a host that cannot read spend, and survives a failed read', async () => {
    const bridge = Object.assign(createFakeHostBridge(), {
      usageSummary: () => Promise.reject(new Error('engine down')),
    });
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <SpendCard />
      </HostBridgeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('Tagalong could not read what was spent.')).toBeInTheDocument(),
    );
    expect(container).toBeTruthy();
  });
});
