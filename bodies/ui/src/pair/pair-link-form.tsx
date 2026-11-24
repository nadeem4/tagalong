/**
 * Paste a pairing link, pair, and say what went wrong in plain words. Contains PairLinkForm.
 * The host does the pairing; this only shows the outcome.
 */

import { useState } from 'react';
import { Button } from '../controls';
import type { PairOutcome } from '../shapes/pairing';
import { linkHost, pairErrorLine } from './pair-text';

interface PairLinkFormProps {
  /** The brain's name when one was picked from the nearby list. */
  name: string | null;
  pair: (text: string) => Promise<PairOutcome>;
  onPaired: (name: string) => void;
}

export function PairLinkForm({ name, pair, onPaired }: PairLinkFormProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    const link = text.trim();
    const shown = name ?? linkHost(link) ?? 'the brain';
    setBusy(true);
    setError('');
    try {
      const outcome = await pair(link);
      if (outcome.ok) onPaired(shown);
      else setError(pairErrorLine(outcome.reason, shown));
    } catch {
      setError(pairErrorLine('unreachable', shown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="pair-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="pair-label" htmlFor="pair-link">
        Pairing link
      </label>
      <p className="wt-help">
        {name === null
          ? 'Paste the link the other computer showed.'
          : `Paste the pairing link from ${name}. Run tagalong pair there to get one.`}
      </p>
      <div className="pair-copy">
        <input
          id="pair-link"
          className="pair-input"
          value={text}
          placeholder="tagalong://pair?..."
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
        />
        <Button variant="primary" type="submit" disabled={busy || text.trim() === ''}>
          {busy ? 'Pairing…' : 'Pair'}
        </Button>
      </div>
      {error !== '' && (
        <p className="pair-alert pair-alert--err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
