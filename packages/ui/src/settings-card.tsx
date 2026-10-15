import { useState } from 'react';
import type { SettingsProposedParams } from '@tagalong/protocol';
import { useHostBridge } from './host-bridge';

/**
 * Change settings by talking: the card says each setting now and after, built like the
 * routine card. Apply is the person's consent, and a click only: a spoken "yes" never
 * applies it. A change that lets Scout see, keep or spend more is marked, and the button
 * then reads Turn on. Cancel is local: nothing was saved.
 */
export function SettingsCard({
  proposal,
  onDone,
}: {
  proposal: SettingsProposedParams;
  onDone: () => void;
}) {
  const bridge = useHostBridge();
  const [error, setError] = useState<string | null>(null);
  const loosens = proposal.rows.some((row) => row.loosens);

  const apply = async (): Promise<void> => {
    if (bridge.applySettings === undefined) {
      setError('This window can’t apply settings. Change them in Settings instead.');
      return;
    }
    try {
      await bridge.applySettings(proposal.patch);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <section className="handoff settings-card" aria-label="Change these settings?">
      <p className="bubble-text">Here’s what I’d change. Nothing changes until you apply it.</p>
      <dl className="handoff-rows">
        {proposal.rows.map((row, index) => (
          <div key={`${row.setting}-${index}`} className={row.loosens ? 'loosens' : undefined}>
            <dt>{row.label}</dt>
            <dd>
              <span>
                {row.from} → {row.to}
              </span>
              {row.note !== undefined && (
                <small className={row.loosens ? 'bubble-warning' : undefined}>{row.note}</small>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {error !== null && (
        <p role="alert" className="bubble-error">
          {error}
        </p>
      )}
      <div className="bubble-row">
        <button type="button" className="bubble-primary" onClick={() => void apply()}>
          {loosens ? 'Turn on' : 'Apply'}
        </button>
        <button type="button" className="bubble-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}
