/**
 * Home's Waiting on you: every ask that waits on the person (a change in a connected app, a
 * hand-off card), with Allow once, Decline or Open, and the last ones answered, with how each
 * ended. The status words are fixed UI labels, never Scout's lines. Contains WaitingView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Ask, AsksListResult } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';

function when(iso: string | undefined): string {
  if (iso === undefined) return '';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** What the ask is, in a few words: the app and its tool, or who the card hands to. */
function title(ask: Ask): string {
  return ask.kind === 'handoff'
    ? `Hand to ${ask.expertName ?? 'an expert'}`
    : `Change in ${ask.app ?? 'an app'}${ask.tool === undefined ? '' : ` · ${ask.tool}`}`;
}

function riskLabel(ask: Ask): string {
  return ask.risk === 'high' ? 'Can’t be undone' : 'Changes something';
}

/** How an answered ask ended. Every one but Approved says nothing was changed. */
function endedWords(ask: Ask): string {
  const ended = (() => {
    switch (ask.state) {
      case 'approved':
        return 'Approved by you';
      case 'declined':
        return 'Declined by you';
      case 'expired':
        return ask.note === 'closed'
          ? 'Expired: Tagalong closed first'
          : 'Expired: no answer in time';
      case 'cancelled':
        return ask.note === 'expert-unavailable'
          ? 'Cancelled: expert no longer available'
          : 'Cancelled: the conversation was stopped';
      case 'waiting':
        return 'Waiting';
    }
  })();
  return ask.state === 'approved' || ask.state === 'waiting'
    ? ended
    : `${ended}. Nothing was changed.`;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Waiting on you. Read with `listAsks`, again on every `asks.changed`, so an ask answered on
 * its card, expired or closed leaves this list at once. A failed answer shows beside the list.
 */
export function WaitingView() {
  const bridge = useHostBridge();
  const [list, setList] = useState<AsksListResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    void bridge
      .listAsks?.()
      .then(setList)
      .catch((error: unknown) => setProblem(`Could not read what is waiting: ${reasonOf(error)}`));
  }, [bridge]);

  useEffect(() => {
    reload();
    return bridge.onTurnEvent((event) => {
      if (event.type === 'asks.changed') reload();
    });
  }, [bridge, reload]);

  const run = (call: Promise<unknown> | undefined): void => {
    setProblem(null);
    void call
      ?.then(reload)
      .catch((error: unknown) => setProblem(`Not answered: ${reasonOf(error)}`));
  };

  if (bridge.listAsks === undefined) {
    return <p className="home-note">Waiting on you is not available here.</p>;
  }

  return (
    <>
      <h1 className="home-title">Waiting on you</h1>
      {problem !== null && (
        <p className="tg-error" role="alert">
          {problem}
        </p>
      )}
      <section className="home-card" aria-label="Waiting">
        <h2 className="home-card__label">WAITING</h2>
        {list !== null && list.waiting.length === 0 && <p>Nothing is waiting on you.</p>}
        {list !== null && list.waiting.length > 0 && (
          <ul className="home-learned__changes">
            {list.waiting.map((ask) => {
              const [what, ...details] = ask.summary.split('\n');
              return (
                <li key={ask.id} aria-label={title(ask)}>
                  <span className="home-said__who">
                    {title(ask)} · {riskLabel(ask)}
                  </span>
                  <span>{what}</span>
                  {details.length > 0 && (
                    // Every argument in full; long ones scroll. Focusable so the keyboard can too.
                    <span className="home-ask__details" tabIndex={0}>
                      {details.join('\n')}
                    </span>
                  )}
                  <p className="home-card__row">
                    <span>
                      Asked {when(ask.createdAt)}
                      {ask.expiresAt === undefined ? '' : ` · ends ${when(ask.expiresAt)}`}
                    </span>
                    <span className="home-learned__actions">
                      {ask.kind === 'handoff' ? (
                        <button
                          type="button"
                          className="tg-btn"
                          onClick={() => run(bridge.openAsk?.(ask.id))}
                        >
                          Open
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="tg-btn"
                          onClick={() => run(bridge.answerAsk?.(ask.id, 'approve'))}
                        >
                          Allow once
                        </button>
                      )}
                      <button
                        type="button"
                        className="tg-btn-quiet"
                        onClick={() => run(bridge.answerAsk?.(ask.id, 'decline'))}
                      >
                        Decline
                      </button>
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {list !== null && list.recent.length > 0 && (
        <section className="home-card" aria-label="Answered">
          <h2 className="home-card__label">ANSWERED</h2>
          <ul className="home-learned__changes">
            {list.recent.map((ask) => (
              <li key={ask.id}>
                <p className="home-card__row">
                  <span>
                    <strong>{title(ask)}</strong> · {ask.summary}
                  </span>
                  <span>
                    {endedWords(ask)}
                    {ask.answeredAt === undefined ? '' : ` · ${when(ask.answeredAt)}`}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
