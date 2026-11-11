/**
 * The walkthrough's footer on every step: Back on the left (not on step 1), then a quiet
 * Skip link and the primary Next on the right. Next reads "Get started" on step 1 and stays off
 * on the key step until the key is good. The last step (connect your tools) has no Skip: it
 * offers Finish and a quiet "I'll do this later", which both finish. Contains Footer.
 */

import { Button } from '../controls';
import { KEY_STEP, STEPS } from './steps';

interface FooterProps {
  step: number;
  busy: boolean;
  error: string;
  onBack: () => void;
  onNext: () => void;
  /** Skip: no key jumps to the key step, a key leaves the tour (see skipTour). */
  onSkip: () => void;
  /** Next on the key step is off until the key step says the key is good. */
  keyReady?: boolean;
  onFinish?: () => void;
}

export function Footer({
  step,
  busy,
  error,
  onBack,
  onNext,
  onSkip,
  keyReady = false,
  onFinish,
}: FooterProps) {
  const last = step === STEPS.length;
  const keyStep = step === KEY_STEP;
  return (
    <footer className="wt-footer">
      {step > 1 && (
        <Button variant="secondary" className="wt-back" disabled={busy} onClick={onBack}>
          Back
        </Button>
      )}
      {error !== '' && (
        <p className="wt-error" role="alert">
          {error}
        </p>
      )}
      <span className="wt-spacer" />
      {!last && !keyStep && (
        <button type="button" className="wt-text" disabled={busy} onClick={onSkip}>
          Skip
        </button>
      )}
      {last && (
        <button type="button" className="wt-text" disabled={busy} onClick={onFinish}>
          I’ll do this later
        </button>
      )}
      {last ? (
        <button type="button" className="wt-primary wt-next" disabled={busy} onClick={onFinish}>
          Finish
        </button>
      ) : (
        <button
          type="button"
          className="wt-primary wt-next"
          disabled={busy || (keyStep && !keyReady)}
          onClick={onNext}
        >
          {step === 1 ? 'Get started' : 'Next'}
        </button>
      )}
    </footer>
  );
}
