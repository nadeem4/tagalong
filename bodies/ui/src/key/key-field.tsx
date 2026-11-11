/**
 * The Anthropic key field Settings and the walkthrough share (KeyField), and the daily-limit
 * field beside it (LimitField). The pasted key lives only in this component's input: it is
 * handed to the host once and cleared the moment the check says ok. Never rendered back.
 */

import { useEffect, useRef, useState } from 'react';
import type { KeyResult } from '../host-bridge';
import { Button } from '../controls/button';
import { MoneyField } from '../controls/money-field';
import { failure } from '../failure';
import { Icon } from '../icons';
import { cap, dollars } from '../home/spend-format';
import { useKeyStatus } from './use-key-status';
import type { KeyHost } from './use-key-status';

/** What the last check said; `ok` is shown only until the status refresh reports "already set". */
type Outcome = KeyResult | 'failed' | null;

const COPY = {
  invalid: 'That key was not accepted.',
  unreachable: 'Scout could not reach Anthropic. Try again.',
  offline: 'Scout’s brain is not running.',
  already: 'A key is already set.',
  environment: 'Set by your environment',
  ok: 'Key checked and saved.',
} as const;

export function KeyField({ host, onSaved }: { host: KeyHost; onSaved?: () => void }) {
  const { status, refresh } = useKeyStatus(host);
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [failureText, setFailure] = useState('');
  const [checking, setChecking] = useState(false);
  // A fresh status means the brain answered: an earlier "offline" result no longer holds.
  const [seenStatus, setSeenStatus] = useState(status);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status !== null && status !== 'offline')
      setOutcome((now) => (now === 'offline' ? null : now));
  }
  // A ref, not state: a second press in the same tick must see the first one already running.
  const busy = useRef(false);

  const environment = status !== null && status !== 'offline' && status.source === 'environment';
  const offline = status === 'offline' || outcome === 'offline';
  const already = status !== null && status !== 'offline' && status.hasKey && !environment;
  const canCheck = !checking && !offline && !environment && value.trim() !== '';

  async function check(): Promise<void> {
    if (busy.current || !canCheck) return;
    busy.current = true;
    setChecking(true);
    setOutcome(null);
    try {
      const result = await host.setKey(value);
      setOutcome(result);
      if (result === 'ok') {
        setValue('');
        refresh();
        onSaved?.();
      }
    } catch (error) {
      setFailure(error instanceof Error ? failure(error) : 'Scout could not save the key.');
      setOutcome('failed');
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const statusText = environment
    ? COPY.environment
    : offline
      ? COPY.offline
      : outcome === 'invalid'
        ? COPY.invalid
        : outcome === 'unreachable'
          ? COPY.unreachable
          : outcome === 'failed'
            ? failureText
            : already
              ? COPY.already
              : outcome === 'ok'
                ? COPY.ok
                : '';
  const state =
    outcome === 'invalid' || outcome === 'failed'
      ? 'invalid'
      : checking
        ? 'checking'
        : already || outcome === 'ok'
          ? 'valid'
          : 'empty';

  return (
    <div className="tg-keyfield" data-state={state}>
      <label htmlFor="tg-api-key" className="tg-keyfield__label">
        API key
      </label>
      <div className="tg-keyfield__row">
        <div className="tg-keyfield__box">
          <input
            id="tg-api-key"
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={value}
            disabled={environment}
            aria-invalid={outcome === 'invalid' ? 'true' : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              // Editing after a rejection starts a fresh attempt.
              if (outcome === 'invalid') setOutcome(null);
            }}
            // Settings is one form: Enter here checks the key and must not save the page.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void check();
            }}
          />
          <Button
            variant="quiet"
            className="tg-keyfield__show"
            aria-pressed={shown}
            disabled={environment}
            onClick={() => setShown((now) => !now)}
          >
            {shown ? 'Hide' : 'Show'}
          </Button>
        </div>
        <Button variant="secondary" disabled={!canCheck} onClick={() => void check()}>
          {checking ? 'Checking…' : outcome === 'unreachable' ? 'Try again' : 'Check key'}
        </Button>
      </div>
      <p className="tg-help tg-keyfield__status" role="status" aria-live="polite">
        {statusText}
      </p>
    </div>
  );
}

/** A dollar amount as typed: finite and above 0, or null. */
function parseLimit(text: string): number | null {
  const usd = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(usd) && usd > 0 ? usd : null;
}

type Message = { text: string; error: boolean };

/** How long "Saved." stays under the field. */
const SAVED_MS = 4000;

export function LimitField({
  host,
  limitUsd,
  spentUsd = null,
}: {
  host: { setDailyLimit(usd: number): Promise<void> };
  limitUsd: number;
  /** What is spent today; the spend line and meter show once it is known. */
  spentUsd?: number | null;
}) {
  // The brain's limit is the source; the field follows it when it changes, and edits are local.
  const [text, setText] = useState(limitUsd.toFixed(2));
  const [seen, setSeen] = useState(limitUsd);
  const [message, setMessage] = useState<Message | null>(null);
  if (seen !== limitUsd) {
    setSeen(limitUsd);
    setText(limitUsd.toFixed(2));
  }

  // The saved line fades; an error stays until the next try.
  useEffect(() => {
    if (message === null || message.error) return undefined;
    const timer = setTimeout(() => setMessage(null), SAVED_MS);
    return () => clearTimeout(timer);
  }, [message]);

  async function save(): Promise<void> {
    const usd = parseLimit(text);
    if (usd === null) {
      setMessage({ text: 'Enter an amount above $0.', error: true });
      return;
    }
    try {
      await host.setDailyLimit(usd);
      setMessage({ text: `Saved. Scout stops at ${dollars(usd)} a day.`, error: false });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? failure(error) : 'Scout could not change the limit.',
        error: true,
      });
    }
  }

  const spent = spentUsd !== null && limitUsd > 0;
  const full = spent && spentUsd >= limitUsd;
  const percent = spent ? Math.min(100, Math.round((spentUsd / limitUsd) * 100)) : 0;

  return (
    <div className="tg-limitfield">
      <div className="tg-limitfield__text">
        <span className="tg-limitfield__title">Daily limit</span>
        <p className="tg-help">
          The most Scout spends on this key in a day. When it gets there, Scout pauses until
          midnight.
        </p>
      </div>
      <div className="tg-limitfield__ctl">
        <div className="tg-limitfield__row">
          <MoneyField
            id="tg-daily-limit"
            label="Daily limit (USD)"
            hideLabel
            value={text}
            invalid={message?.error === true}
            onChange={setText}
            onCommit={() => void save()}
          />
          <Button variant="secondary" onClick={() => void save()}>
            Set
          </Button>
        </div>
        {message !== null && (
          <p
            className={message.error ? 'tg-error' : 'tg-saved'}
            role={message.error ? 'alert' : 'status'}
          >
            <Icon name={message.error ? 'err' : 'check'} />
            <span>{message.text}</span>
          </p>
        )}
        {spent && (
          <div className="tg-spend">
            <div className="tg-spend__top">
              <strong>
                {dollars(spentUsd)} of {dollars(limitUsd)} used today
              </strong>
              <span>{percent}%</span>
            </div>
            <div
              className={full ? 'tg-spendmeter tg-spendmeter--full' : 'tg-spendmeter'}
              role="meter"
              aria-label="Spent today"
              aria-valuenow={spentUsd}
              aria-valuemin={0}
              aria-valuemax={limitUsd}
            >
              <i style={{ width: `${percent}%` }} />
            </div>
            {full && (
              <p className="tg-spend__full">
                Today’s {cap(limitUsd)} is spent; Scout pauses until midnight. Raise the limit to
                carry on.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
