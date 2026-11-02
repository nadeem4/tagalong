/**
 * Walkthrough step 6: experts do the heavy work. Sets Claude Code up on a press of one button
 * (install, then the login), showing the brain's progress; previews a hand-off and its card.
 * Contains StepSix. Words are the step's own; the brain only reports short tokens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../controls';
import type { SetupOverview } from '../shapes';
import type { WalkthroughHost } from './walkthrough-host';

const EXPERT = 'claude-acp';

// The step's own words for what the brain reports as short tokens.
const STAGES: Record<string, string> = {
  checking: 'Checking this computer…',
  node: 'Getting Tagalong’s own Node…',
  installing: 'Installing Claude Code’s connector…',
  downloading: 'Downloading Claude Code’s connector…',
  extracting: 'Unpacking it…',
  done: 'Finishing up…',
};
const FAILURES: Record<string, string> = {
  download_failed: 'The download didn’t finish. Check your connection and try again.',
  integrity: 'The download didn’t match its checksum, so Tagalong threw it away.',
  node_failed: 'Tagalong couldn’t get its own Node.',
  npm_failed: 'The install didn’t finish.',
  no_build: 'Claude Code has no build for this computer.',
};
const FAILED_GENERIC = 'Something went wrong setting Claude Code up.';

type View =
  | { kind: 'checking' | 'offline' | 'missing' | 'ready' | 'needs_login' }
  | { kind: 'working'; stage: string; percent?: number }
  | { kind: 'failed'; reason: string };

function viewOf(overview: SetupOverview): View {
  if (overview.progress?.expert === EXPERT) {
    const { stage, percent } = overview.progress;
    return percent === undefined ? { kind: 'working', stage } : { kind: 'working', stage, percent };
  }
  const expert = overview.experts.find((e) => e.id === EXPERT);
  if (expert !== undefined)
    return { kind: expert.state === 'needs_login' ? 'needs_login' : 'ready' };
  if (overview.failed?.expert === EXPERT) {
    return { kind: 'failed', reason: FAILURES[overview.failed.error] ?? FAILED_GENERIC };
  }
  return { kind: 'missing' };
}

export function StepSix({
  host,
}: {
  host: Pick<WalkthroughHost, 'setupOverview' | 'setupExpert' | 'onBrainChanged'>;
}) {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const pressed = useRef(false); // a double press sends one call
  const [busy, setBusy] = useState(false); // the same, for the button to show
  const { setupOverview, setupExpert, onBrainChanged } = host;

  const load = useCallback(() => {
    setupOverview().then(
      (overview) => {
        setView(viewOf(overview));
      },
      () => setView({ kind: 'offline' }),
    );
  }, [setupOverview]);

  useEffect(load, [load]);
  // The brain says `changed setup` as an install moves on; read the overview again each time.
  useEffect(() => onBrainChanged((what) => what === 'setup' && load()), [onBrainChanged, load]);

  function press(): void {
    if (pressed.current) return;
    pressed.current = true;
    setBusy(true);
    setupExpert(EXPERT)
      .then(load, () => setView({ kind: 'failed', reason: FAILED_GENERIC }))
      .finally(() => {
        pressed.current = false;
        setBusy(false);
      });
  }

  const again = () => {
    setView({ kind: 'checking' });
    load();
  };

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
            {view.kind === 'ready' && <p className="wt-help">Claude Code is set up.</p>}
            {view.kind === 'working' && (
              <p className="wt-help">
                {STAGES[view.stage] ?? 'Working…'}
                {view.percent !== undefined && ` ${view.percent}%`}
              </p>
            )}
            {view.kind === 'failed' && <p className="wt-help">{view.reason}</p>}
            {view.kind === 'offline' && (
              <p className="wt-help">Scout’s brain is not running, so it can’t check.</p>
            )}
            {(view.kind === 'missing' || view.kind === 'failed') && (
              <>
                <p className="wt-help">
                  Pressing the button is your OK. Tagalong downloads what Claude Code needs, its own
                  copy of Node included, into its own folder. Nothing else on this computer changes.
                </p>
                <Button variant="primary" className="wt-after" disabled={busy} onClick={press}>
                  {view.kind === 'failed' ? 'Try again' : 'Set up Claude Code'}
                </Button>
              </>
            )}
            {view.kind === 'needs_login' && (
              <>
                <p className="wt-help">
                  Claude Code is installed. It still needs you to sign in with your Claude login.
                </p>
                <Button variant="primary" className="wt-after" disabled={busy} onClick={press}>
                  Log in to Claude Code
                </Button>
                <Button variant="quiet" onClick={again}>
                  Check again
                </Button>
              </>
            )}
            {(view.kind === 'offline' || view.kind === 'checking') && (
              <Button
                variant="quiet"
                className="wt-after"
                disabled={view.kind === 'checking'}
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
