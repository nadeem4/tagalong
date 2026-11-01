/**
 * Walkthrough step 6: experts do the heavy work. Asks the brain whether Claude Code's connector
 * is installed (never whether the login works), walks through a hand-off and previews the card.
 * Contains StepSix. Words are the spec's step copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../controls';
import type { WalkthroughHost } from './walkthrough-host';

const INSTALL = 'npm install -g @agentclientprotocol/claude-agent-acp';

type Check = 'checking' | 'found' | 'missing' | 'offline';

export function StepSix({ host }: { host: Pick<WalkthroughHost, 'expertStatus'> }) {
  const [check, setCheck] = useState<Check>('checking');
  const { expertStatus } = host;

  const load = useCallback(() => {
    expertStatus().then(
      (status) => setCheck(status.found ? 'found' : 'missing'),
      () => setCheck('offline'),
    );
  }, [expertStatus]);

  // The first answer arrives from the brain; only a press of Check again resets to "checking".
  useEffect(load, [load]);

  function again(): void {
    setCheck('checking');
    load();
  }

  return (
    <section>
      <span className="wt-label">Bigger jobs</span>
      <h1>For bigger jobs, Scout calls in an expert</h1>
      <p className="wt-lead">
        When something needs real work, Scout writes a brief and hands it to an expert. You read it
        and press Send; the expert works in the background, and Scout tells you when it’s done.
        Claude Code is the first one.
      </p>
      <div className="wt-cols">
        <div>
          <span className="wt-label">Your expert</span>
          <div className="wt-card" role="status">
            <h3>Claude Code</h3>
            {check === 'found' && (
              <p className="wt-help">Claude Code’s connector is installed on this computer.</p>
            )}
            {check === 'missing' && (
              <>
                <p className="wt-help">Claude Code’s connector was not found.</p>
                <p className="wt-help">Install it with Node 22 or newer:</p>
                <code className="wt-code">{INSTALL}</code>
              </>
            )}
            {check === 'offline' && (
              <p className="wt-help">Scout’s brain is not running, so it can’t check.</p>
            )}
            {check !== 'found' && (
              <Button
                variant="quiet"
                className="wt-after"
                disabled={check === 'checking'}
                onClick={again}
              >
                Check again
              </Button>
            )}
          </div>
          <p className="wt-help" style={{ marginTop: 12 }}>
            Claude Code runs on your own Claude login, not the API key you’ll add at the end. Follow
            each job in Home &gt; Jobs.
          </p>
          <span className="wt-label wt-sub-label">How a hand-off goes</span>
          <ol className="wt-steplist">
            <li>Scout writes a short brief.</li>
            <li>You read it and press Send.</li>
            <li>Scout tells you when it’s done.</li>
          </ol>
        </div>
        <div aria-hidden="true">
          <span className="wt-label">What you’ll be asked</span>
          <div className="wt-handoff">
            <h3>Hand this to Claude Code?</h3>
            <p className="wt-handoff__row">
              <span>Folder</span>
              <code>~\shop-api</code>
            </p>
            <p className="wt-handoff__row">
              <span>Task</span>
              <span>Fix the empty-cart crash in billing.ts and add a test.</span>
            </p>
            <div className="wt-handoff__actions">
              <span className="wt-handoff__cancel">Cancel</span>
              <span className="wt-handoff__send">Send</span>
            </div>
          </div>
        </div>
      </div>
      <p className="wt-note">More experts are coming.</p>
    </section>
  );
}
