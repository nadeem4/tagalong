/**
 * The standing-preference cards on Home's Approvals page: each sentence Scout follows, when it
 * was agreed and how often it was used, with Remove and an inline Edit. The built-in default is
 * listed first and treated like any other. Contains PreferencesList.
 */
import { useState } from 'react';
import type { PreferenceRow } from '../host-bridge';

interface Props {
  /** Null until a read succeeds: then nothing is claimed, not even "none yet". */
  preferences: readonly PreferenceRow[] | null;
  /** Reject when the brain refuses, so the card can say why. */
  onRemove(id: number): Promise<void>;
  onEdit(id: number, sentence: string): Promise<void>;
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

const dayAndTime = (iso: string): string =>
  `${day(iso)}, ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function PreferencesList({ preferences, onRemove, onEdit }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Stable sort: the default first, the rest in the order the brain sent.
  const shown = [...(preferences ?? [])].sort((a, b) => Number(b.builtin) - Number(a.builtin));

  const start = (pref: PreferenceRow): void => {
    setEditing(pref.id);
    setDraft(pref.sentence);
    setError(null);
  };

  const save = (pref: PreferenceRow): void => {
    const sentence = draft.trim();
    if (sentence === '') {
      setError('Write a sentence, or Cancel.');
      return;
    }
    onEdit(pref.id, sentence).then(
      () => {
        setEditing(null);
        setError(null);
      },
      (failure: unknown) => setError(reason(failure)),
    );
  };

  const remove = (pref: PreferenceRow): void => {
    onRemove(pref.id).then(
      () => setError(null),
      (failure: unknown) => setError(reason(failure)),
    );
  };

  return (
    <section aria-labelledby="apv-prefs" className="apv-section">
      <h2 className="home-card__label" id="apv-prefs">
        STANDING PREFERENCES
      </h2>
      {preferences !== null && shown.length === 0 && (
        <p className="tg-note">
          None yet. Scout offers one after you approve the same kind of thing a few times.
        </p>
      )}
      {error !== null && (
        <p role="alert" className="tg-error apv-error">
          {error}
        </p>
      )}
      <ul aria-label="Standing preferences" className="apv-prefs">
        {shown.map((pref) => (
          <li key={pref.id} className="home-card apv-pref">
            {editing === pref.id ? (
              <div className="apv-pref__edit tg-panel">
                <label>
                  <span>Preference sentence</span>
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-invalid={error !== null}
                  />
                </label>
                <div className="apv-pref__actions">
                  <button type="button" className="tg-btn" onClick={() => save(pref)}>
                    Save
                  </button>
                  <button type="button" className="tg-btn-quiet" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="apv-pref__body">
                  <q className="apv-pref__sentence">{pref.sentence}</q>
                  <span className="apv-pref__meta">
                    <span>
                      Agreed <b>{day(pref.createdAt)}</b>
                    </span>
                    <span>
                      Used <b>{pref.useCount === 1 ? '1 time' : `${pref.useCount} times`}</b>
                    </span>
                    {pref.lastUsed !== null && (
                      <span>
                        Last used <b>{dayAndTime(pref.lastUsed)}</b>
                      </span>
                    )}
                  </span>
                </div>
                <div className="apv-pref__actions">
                  <button
                    type="button"
                    className="apv-btn"
                    aria-label={`Edit: ${pref.sentence}`}
                    onClick={() => start(pref)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="apv-btn"
                    aria-label={`Remove: ${pref.sentence}`}
                    onClick={() => remove(pref)}
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
