/**
 * The Anthropic key field Settings and the walkthrough share (KeyField), and the daily-limit
 * field beside it (LimitField). The pasted key lives only in this component's input: it is
 * handed to the host once and cleared the moment the check says ok. Never rendered back.
 */

import { useRef, useState } from 'react';
import type { KeyResult } from '../host-bridge';
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
  const [failure, setFailure] = useState('');
  const [checking, setChecking] = useState(false);
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
      setFailure(error instanceof Error ? error.message : 'Scout could not save the key.');
      setOutcome('failed');
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  return (
    <div className="tg-keyfield">
      <label htmlFor="tg-api-key">
        <span>API key</span>
        <input
          id="tg-api-key"
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={environment}
          onChange={(event) => setValue(event.target.value)}
          // Settings is one form: Enter here checks the key and must not save the page.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void check();
          }}
        />
      </label>
      <div className="tg-inline">
        <button
          type="button"
          className="tg-btn-quiet"
          disabled={environment}
          onClick={() => setShown((now) => !now)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="tg-btn" disabled={!canCheck} onClick={() => void check()}>
          {checking ? 'Checking…' : outcome === 'unreachable' ? 'Try again' : 'Check key'}
        </button>
      </div>
      <p className="tg-help" role="status">
        {environment
          ? COPY.environment
          : offline
            ? COPY.offline
            : outcome === 'invalid'
              ? COPY.invalid
              : outcome === 'unreachable'
                ? COPY.unreachable
                : outcome === 'failed'
                  ? failure
                  : already
                    ? COPY.already
                    : outcome === 'ok'
                      ? COPY.ok
                      : ''}
      </p>
    </div>
  );
}

/** A dollar amount as typed: finite and above 0, or null. */
function parseLimit(text: string): number | null {
  const usd = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(usd) && usd > 0 ? usd : null;
}

export function LimitField({
  host,
  limitUsd,
}: {
  host: { setDailyLimit(usd: number): Promise<void> };
  limitUsd: number;
}) {
  // The brain's limit is the source; the field follows it when it changes, and edits are local.
  const [text, setText] = useState(String(limitUsd));
  const [seen, setSeen] = useState(limitUsd);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (seen !== limitUsd) {
    setSeen(limitUsd);
    setText(String(limitUsd));
  }

  async function save(): Promise<void> {
    const usd = parseLimit(text);
    if (usd === null) {
      setMessage({ text: 'Enter an amount above $0.', error: true });
      return;
    }
    try {
      await host.setDailyLimit(usd);
      setMessage({ text: 'Daily limit saved.', error: false });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Scout could not change the limit.',
        error: true,
      });
    }
  }

  return (
    <div className="tg-limitfield">
      <label htmlFor="tg-daily-limit">
        <span>Daily limit (USD)</span>
        <input
          id="tg-daily-limit"
          type="number"
          min="0"
          step="any"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void save();
          }}
        />
      </label>
      <div className="tg-inline">
        <button type="button" className="tg-btn-quiet" onClick={() => void save()}>
          Set limit
        </button>
      </div>
      {message !== null && (
        <p
          className={message.error ? 'tg-error' : 'tg-saved'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
