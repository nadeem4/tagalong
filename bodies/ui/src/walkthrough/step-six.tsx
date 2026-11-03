/**
 * Walkthrough step 6: the everyday jobs Scout does, each with a one-click Connect for the app it
 * needs. One optional line opens the expert setup (Claude Code: install, then login, with the
 * brain's progress, and a hand-off preview). Contains StepSix. Words are the step's own; the
 * brain only reports short tokens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../controls';
import { JOB_KINDS } from '../jobs-kinds';
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
const APP_FAILURES: Record<string, string> = {
  denied: 'You said no, so nothing was added.',
  already_added: 'That one is already connected.',
};
const APP_FAILED_GENERIC = 'It didn’t connect. Check your connection and try again.';

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

/** Whether a job's app is connected, can be connected from the registry, or is not offered. */
function appOf(
  overview: SetupOverview | null,
  key: string,
): { state: 'connected' | 'available' | 'missing'; id?: string } {
  if (overview === null) return { state: 'missing' };
  const has = (name: string) => name.toLowerCase().includes(key);
  if (overview.apps.some((a) => has(a.name))) return { state: 'connected' };
  const found = overview.browseApps.find((a) => has(a.id) || has(a.name));
  return found === undefined ? { state: 'missing' } : { state: 'available', id: found.id };
}

export function StepSix({
  host,
}: {
  host: Pick<WalkthroughHost, 'setupOverview' | 'setupExpert' | 'setupApp' | 'onBrainChanged'>;
}) {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [overview, setOverview] = useState<SetupOverview | null>(null);
  const [open, setOpen] = useState(false); // the optional expert line
  // Per app key: connecting now, or the plain words for why it did not connect.
  const [connect, setConnect] = useState<Record<string, { busy: boolean; error?: string }>>({});
  const connecting = useRef(new Set<string>()); // a double press sends one call
  const pressed = useRef(false); // a double press sends one call
  const [waiting, setWaiting] = useState(false); // a login window is open
  const [busy, setBusy] = useState(false); // the same, for the button to show
  const { setupOverview, setupExpert, setupApp, onBrainChanged } = host;

  const load = useCallback(() => {
    setupOverview().then(
      (next) => {
        setOverview(next);
        setView(viewOf(next));
      },
      () => {
        setOverview(null);
        setView({ kind: 'offline' });
      },
    );
  }, [setupOverview]);

  useEffect(load, [load]);
  // The brain says `changed setup` as an install moves on; read the overview again each time.
  useEffect(
    () =>
      onBrainChanged((what) => {
        if (what !== 'setup') return;
        setWaiting(false); // a login that ended says so the same way
        load();
      }),
    [onBrainChanged, load],
  );

  function connectApp(key: string, id: string): void {
    if (connecting.current.has(key)) return;
    connecting.current.add(key);
    setConnect((c) => ({ ...c, [key]: { busy: true } }));
    setupApp(id)
      .then(
        () => setConnect((c) => ({ ...c, [key]: { busy: false } })),
        (err: unknown) => {
          const error = APP_FAILURES[err instanceof Error ? err.message : ''] ?? APP_FAILED_GENERIC;
          setConnect((c) => ({ ...c, [key]: { busy: false, error } }));
        },
      )
      .finally(() => {
        connecting.current.delete(key);
        load();
      });
  }

  function press(): void {
    if (pressed.current) return;
    pressed.current = true;
    setBusy(true);
    setupExpert(EXPERT)
      .then(
        (result) => {
          setWaiting(result.state === 'waiting');
          load();
        },
        () => setView({ kind: 'failed', reason: FAILED_GENERIC }),
      )
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
      <span className="wt-label">Everyday jobs</span>
      <h1>Scout does the everyday jobs</h1>
      <p className="wt-lead">
        Say what you need. Scout uses your apps for it and asks before anything leaves this
        computer. Connect the ones you want now, or any time in Home.
      </p>
      <ul className="wt-jobs">
        {JOB_KINDS.map((job) => {
          const wanted = job.app;
          const app = wanted === undefined ? null : appOf(overview, wanted.key);
          const state = wanted === undefined ? undefined : connect[wanted.key];
          return (
            <li key={job.label} className="wt-job">
              <div className="wt-job__text">
                <h3>{job.label}</h3>
                <p className="wt-help">{job.help}</p>
                {state?.error !== undefined && (
                  <p className="wt-help" role="alert">
                    {state.error}
                  </p>
                )}
              </div>
              {wanted !== undefined && app !== null && (
                <div className="wt-job__act">
                  {app.state === 'connected' && (
                    <p className="wt-help" role="status">
                      {wanted.name} is connected.
                    </p>
                  )}
                  {app.state === 'available' && state?.busy === true && (
                    <p className="wt-help" role="status">
                      Connecting {wanted.name}…
                    </p>
                  )}
                  {app.state === 'available' && state?.busy !== true && app.id !== undefined && (
                    <Button
                      variant="quiet"
                      onClick={() => connectApp(wanted.key, app.id as string)}
                    >
                      {state?.error === undefined
                        ? `Connect ${wanted.name}`
                        : `Try ${wanted.name} again`}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="wt-note">
        <Button
          variant="quiet"
          aria-expanded={open}
          aria-controls="wt-expert"
          onClick={() => setOpen((o) => !o)}
        >
          For long jobs, Scout can also use an expert
        </Button>
      </div>
      {open && (
        <div id="wt-expert" className="wt-expert">
          <p className="wt-lead">
            When something needs real work, Scout writes a brief and hands it to an expert. You read
            it and press Send; the expert works in the background, and Scout tells you when it’s
            done. Claude Code is the first one.
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
                      Pressing the button is your OK. Tagalong downloads what Claude Code needs, its
                      own copy of Node included, into its own folder. Nothing else on this computer
                      changes.
                    </p>
                    <Button variant="primary" className="wt-after" disabled={busy} onClick={press}>
                      {view.kind === 'failed' ? 'Try again' : 'Set up Claude Code'}
                    </Button>
                  </>
                )}
                {view.kind === 'needs_login' && waiting && (
                  <p className="wt-help">Finish logging in in the window that opened.</p>
                )}
                {view.kind === 'needs_login' && !waiting && (
                  <>
                    <p className="wt-help">
                      Claude Code is installed. It still needs you to sign in with your Claude
                      login.
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
                Claude Code runs on your own Claude login, not the API key you’ll add at the end.
                Follow each job in Home &gt; Jobs.
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
        </div>
      )}
    </section>
  );
}
