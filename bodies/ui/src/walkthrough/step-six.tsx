/**
 * Walkthrough step 6: experts do the heavy work. Asks the brain whether Claude Code's connector
 * is installed (never whether the login works) and lists the experts still to come. Contains
 * StepSix. Words are the spec's step copy.
 */

import { useCallback, useEffect, useState } from 'react';
import type { WalkthroughHost } from './walkthrough-host';

const INSTALL = 'npm install -g @agentclientprotocol/claude-agent-acp';

const COMING: readonly { name: string; note: string; when: 'Coming soon' | 'Later' }[] = [
  { name: 'Gemini CLI', note: 'Google’s coding agent', when: 'Coming soon' },
  { name: 'Codex', note: 'OpenAI’s coding agent', when: 'Coming soon' },
  { name: 'Other coding agents', note: '', when: 'Coming soon' },
  { name: 'Model APIs and tool servers', note: 'Experts that aren’t coding agents', when: 'Later' },
];

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
      <h1>Experts do the heavy work</h1>
      <p className="wt-lead">
        When something needs real work, Scout writes a brief and hands it to an expert. You read it
        and press Send; the expert works in the background, and Scout tells you when it’s done.
        Claude Code is the first one.
      </p>
      <div className="wt-cols">
        <div>
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
              <button
                type="button"
                className="wt-quiet"
                disabled={check === 'checking'}
                onClick={again}
              >
                Check again
              </button>
            )}
          </div>
          <p className="wt-help" style={{ marginTop: 12 }}>
            Claude Code runs on your own Claude login, not the API key you’ll add at the end. Follow
            each job in Home &gt; Jobs.
          </p>
          <div style={{ marginTop: 24 }}>
            <span className="wt-label">Coming next</span>
            <ul className="wt-rows">
              {COMING.map((expert) => (
                <li key={expert.name}>
                  <span>
                    {expert.name}
                    {expert.note !== '' && <span className="wt-help"> {expert.note}</span>}
                  </span>
                  <span className="wt-tag">{expert.when}</span>
                </li>
              ))}
            </ul>
            <p className="wt-help">
              Each expert you add shows up here and in Home, and Scout picks the right one for the
              job.
            </p>
          </div>
        </div>
        <div aria-hidden="true">
          <span className="wt-label">What it looks like</span>
          <div className="wt-example">
            <span className="wt-chip">Hand this to Claude Code?</span>
            <p>Folder ~\shop-api</p>
            <p>Fix the empty-cart crash in billing.ts and add a test.</p>
            <span className="wt-fake-button">Edit</span>{' '}
            <span className="wt-fake-button">Send</span>
            <p>Working</p>
          </div>
        </div>
      </div>
    </section>
  );
}
