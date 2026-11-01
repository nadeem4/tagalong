/**
 * The card after Finish: where Scout is and the keys to use it. Finish already marked the tour
 * seen; Done and Open Home only close the window. Contains FinishCard. Words are the spec's last card.
 */

import { Button, Shortcut } from '../controls';

interface FinishCardProps {
  /** The ask key as a person reads it, e.g. Ctrl+Shift+Space. */
  askKey: string;
  talkKey: string;
  onOpenHome: () => void;
  onClose: () => void;
  /** Why closing failed, if it did. */
  error?: string;
}

const TRY = [
  'What’s on today?',
  'Say no to Thursday, kindly',
  'Remind me in 20 minutes to call Sam',
];

export function FinishCard({ askKey, talkKey, onOpenHome, onClose, error }: FinishCardProps) {
  return (
    <>
      <div className="wt-body">
        <section>
          <span className="wt-label">All set</span>
          <h1>Scout is on your screen</h1>
          <p className="wt-lead">
            Look for Scout at the bottom right. Press the ask key to ask, or hold the talk key to
            talk.
          </p>
          <div className="wt-cols wt-cols--even">
            <div>
              <span className="wt-label">Keys to remember</span>
              <ul className="wt-keylist">
                <li>
                  <span>Ask</span>
                  <Shortcut accelerator={askKey} />
                </li>
                <li>
                  <span>Talk</span>
                  <Shortcut accelerator={talkKey} />
                </li>
              </ul>
            </div>
            <div>
              <span className="wt-label" id="wt-try">
                Try these first
              </span>
              <ul className="wt-keylist" aria-labelledby="wt-try">
                {TRY.map((line) => (
                  <li key={line}>
                    <q>{line}</q>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="wt-note">
            Connected apps, timers and what Scout remembers are in Home whenever you want them.
          </p>
        </section>
      </div>
      <footer className="wt-footer">
        {error ? (
          <p className="wt-error" role="alert">
            {error}
          </p>
        ) : null}
        <span className="wt-spacer" />
        <Button variant="secondary" onClick={onOpenHome}>
          Open Home
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </>
  );
}
