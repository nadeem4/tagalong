/**
 * Home's Spend card: today's and this month's usage by who spent it (Scout or the experts)
 * and on which service, and whether the daily budget paused proactive comments. Contains
 * SpendCard and formatSpend.
 */

import { useCallback, useEffect, useState } from 'react';
import type { UsageRow, UsageSummaryResult } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { changesActivity } from './activity-view';

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  fake: 'Fake',
};

/** "Scout · OpenRouter", "Experts · Claude Code". The sign-in reads as itself for Scout. */
function who(row: UsageRow): string {
  const provider =
    row.providerId === 'claude-code'
      ? row.source === 'scout'
        ? 'Claude sign-in'
        : 'Claude Code'
      : (PROVIDER_LABELS[row.providerId] ?? row.providerId);
  return `${row.source === 'scout' ? 'Scout' : 'Experts'} · ${provider}`;
}

function tokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function dollars(usd: number): string {
  return usd > 0 && usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

/** A cap as the person typed it: "$1", "$2.50". */
function cap(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * One row's amount. Dollars only for priced calls; a model with no known price shows its
 * tokens and says so, and the Claude sign-in is the person's plan, so never money.
 */
export function formatSpend(row: UsageRow): string {
  if (row.providerId === 'claude-code') {
    return `${tokens(row.inputTokens + row.outputTokens)} tokens (your plan)`;
  }
  const unknown = `${tokens(row.unpricedTokens)} tokens · price unknown`;
  if (row.costUsd === null) return unknown;
  return row.unpricedTokens > 0 ? `${dollars(row.costUsd)} + ${unknown}` : dollars(row.costUsd);
}

function Rows({ rows }: { rows: readonly UsageRow[] }) {
  return rows.map((row) => (
    <p key={`${row.source}:${row.providerId}`} className="home-card__row">
      <span>{who(row)}</span>
      <span>{formatSpend(row)}</span>
    </p>
  ));
}

/**
 * Home's Spend card: what Scout and the experts used today and this month, and whether
 * the daily budget has paused proactive comments. Read again whenever a turn, a hand-off
 * or a routine run finishes, the same moments Activity refreshes.
 */
export function SpendCard() {
  const bridge = useHostBridge();
  const [summary, setSummary] = useState<UsageSummaryResult | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    const read = bridge.usageSummary;
    if (read === undefined) return;
    read
      .call(bridge)
      .then((next) => {
        setFailed(false);
        setSummary(next);
      })
      .catch(() => setFailed(true));
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onTurnEvent((event) => {
      if (changesActivity(event)) refresh();
    });
  }, [bridge, refresh]);

  if (bridge.usageSummary === undefined) return null;
  const { dailyUsd, spentOut } = summary?.budget ?? { dailyUsd: null, spentOut: false };
  return (
    <section className="home-card" aria-label="Spend">
      <h2 className="home-card__label">SPEND</h2>
      {failed && summary === null && <p>Tagalong could not read what was spent.</p>}
      {summary !== null && (
        <>
          {spentOut && dailyUsd !== null && (
            <p className="home-card__lead">
              Proactive comments paused: today’s {cap(dailyUsd)} is spent.
            </p>
          )}
          <h3 className="home-card__label">TODAY</h3>
          {summary.today.length === 0 ? (
            <p>Nothing spent yet today.</p>
          ) : (
            <Rows rows={summary.today} />
          )}
          {summary.month.length > 0 && (
            <>
              <h3 className="home-card__label">THIS MONTH</h3>
              <Rows rows={summary.month} />
            </>
          )}
        </>
      )}
    </section>
  );
}
