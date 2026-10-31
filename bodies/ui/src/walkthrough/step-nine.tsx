/**
 * Walkthrough step 9: the Anthropic key, the one thing Tagalong cannot work without. Wraps the
 * shared KeyField and tells the shell whether the key is good (checked, already set, or from the
 * environment) so Finish can turn on. Contains StepNine. Words are the spec's step copy.
 */

import { useEffect } from 'react';
import { KeyField } from '../key/key-field';
import { useKeyStatus } from '../key/use-key-status';
import type { KeyHost } from '../key/use-key-status';
import type { WalkthroughHost } from './walkthrough-host';

export function StepNine({
  host,
  onValid,
}: {
  host: KeyHost & Pick<WalkthroughHost, 'openKeyPage'>;
  /** Called with whether Finish may be on; false while offline or until the key is good. */
  onValid: (valid: boolean) => void;
}) {
  const { status, refresh } = useKeyStatus(host);
  const facts = status !== null && status !== 'offline' ? status : null;
  const valid = facts?.hasKey === true;

  useEffect(() => {
    onValid(valid);
  }, [valid, onValid]);

  return (
    <section>
      <h1>Add your Anthropic API key</h1>
      <p className="wt-lead">
        Scout thinks with Claude, through your own Anthropic account. This is the one thing Tagalong
        can’t work without.
      </p>
      <div style={{ marginTop: 24, maxWidth: 520 }}>
        <KeyField host={host} onSaved={refresh} />
        <p className="wt-help">
          In the Anthropic Console, open API keys and choose Create key. It starts with sk-ant-.{' '}
          <button type="button" className="wt-link" onClick={() => void host.openKeyPage()}>
            Where do I get one?
          </button>
        </p>
      </div>
      <div className="wt-note">
        <h3>Kept only on your brain</h3>
        <p className="wt-help">
          The desktop hands the key to your brain once and keeps no copy. The brain saves it in one
          file and never writes it to Scout’s history or logs.
        </p>
        {facts !== null && facts.source !== 'environment' && (
          <p className="wt-help">Saved on the machine running Scout’s brain in {facts.envPath}</p>
        )}
        {facts !== null && (
          <p className="wt-help">
            Anthropic bills this key for what Scout uses, up to your daily limit of $
            {facts.dailyLimitUsd}.
          </p>
        )}
      </div>
    </section>
  );
}
