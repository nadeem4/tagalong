/**
 * Walkthrough step 10: the Anthropic key, the one thing Tagalong cannot work without. Wraps the
 * shared KeyField (or, on a desktop paired to another computer whose brain already has the key,
 * a note saying so) and tells the shell whether the key is good (checked, already set, or from
 * the environment) so Finish can turn on. Contains StepNine. Words are the spec's step copy.
 */

import { useEffect } from 'react';
import { KeyField } from '../key/key-field';
import { useKeyStatus } from '../key/use-key-status';
import type { KeyHost } from '../key/use-key-status';
import type { WalkthroughHost } from './walkthrough-host';

export function StepNine({
  host,
  onValid,
  brainName = null,
}: {
  host: KeyHost & Pick<WalkthroughHost, 'openKeyPage'>;
  /** Called with whether Finish may be on; false while offline or until the key is good. */
  onValid: (valid: boolean) => void;
  /** The other computer the brain runs on, when this PC is paired to one. */
  brainName?: string | null;
}) {
  const { status, refresh } = useKeyStatus(host);
  const facts = status !== null && status !== 'offline' ? status : null;
  const valid = facts?.hasKey === true;
  // An environment key is not Scout's to save or change, so those two notes would be false.
  const fromEnv = facts?.source === 'environment';

  useEffect(() => {
    onValid(valid);
  }, [valid, onValid]);

  const onOtherBrain = brainName !== null && valid;

  return (
    <section>
      <span className="wt-label">API key</span>
      <h1>{onOtherBrain ? 'Your API key is already set' : 'Add your Anthropic API key'}</h1>
      <p className="wt-lead">
        {onOtherBrain
          ? `Scout’s brain runs on ${brainName}, and the key lives there. This PC never holds it.`
          : 'Scout thinks with Claude, through your own Anthropic account. This is the one thing Tagalong can’t work without.'}
      </p>
      {onOtherBrain ? (
        <div className="tg-card wt-notes">
          <p>
            <strong>Already set on {brainName}</strong>
          </p>
          <p className="wt-help">
            To change or remove it, use Settings after the tour, or run tagalong key set on{' '}
            {brainName}.
          </p>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 24, maxWidth: 520 }}>
            <KeyField host={host} onSaved={refresh} />
            <p className="wt-help">
              In the Anthropic Console, open API keys and choose Create key. It starts with sk-ant-.{' '}
              <button type="button" className="wt-link" onClick={() => void host.openKeyPage()}>
                Where do I get one?
              </button>
            </p>
          </div>
          <div className="tg-card wt-notes">
            <ul className="wt-checks">
              {fromEnv || <li>Saved by Scout’s brain, in one file on the machine it runs on</li>}
              <li>Only sent to Anthropic</li>
              <li>Never written to Scout’s history or logs</li>
              {fromEnv || <li>Change or remove it any time in Settings</li>}
            </ul>
            {facts !== null && !fromEnv && (
              <p className="wt-help">
                Saved on the machine running Scout’s brain in {facts.envPath}
              </p>
            )}
            <p className="wt-help">
              The desktop hands the key to your brain once and keeps no copy.
            </p>
            {facts !== null && (
              <p className="wt-help">
                Anthropic bills this key for what Scout uses, up to your daily limit of $
                {facts.dailyLimitUsd}.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
