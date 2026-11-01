/**
 * The walkthrough's footer on every step: Back on the left (not on step 1), then a quiet
 * Skip link and the primary Next on the right. Next reads "Get started" on step 1 and
 * "Finish" on the last step, which stays off until the key step says the key is good.
 * Contains Footer.
 */

import { STEPS } from './steps';

interface FooterProps {
  step: number;
  busy: boolean;
  error: string;
  onBack: () => void;
  onNext: () => void;
  /** Skip: no key jumps to the key step, a key leaves the tour (see skipTour). */
  onSkip: () => void;
  /** Finish is off until the key step says the key is good. */
  canFinish?: boolean;
  onFinish?: () => void;
}

export function Footer({
  step,
  busy,
  error,
  onBack,
  onNext,
  onSkip,
  canFinish = false,
  onFinish,
}: FooterProps) {
  const last = step === STEPS.length;
  return (
    <footer className="wt-footer">
      {step > 1 && (
        <button type="button" className="wt-back" disabled={busy} onClick={onBack}>
          Back
        </button>
      )}
      {error !== '' && (
        <p className="wt-error" role="alert">
          {error}
        </p>
      )}
      <span className="wt-spacer" />
      {!last && (
        <button type="button" className="wt-text" disabled={busy} onClick={onSkip}>
          Skip
        </button>
      )}
      {last ? (
        <button
          type="button"
          className="wt-primary wt-next"
          disabled={!canFinish || busy}
          onClick={onFinish}
        >
          Finish
        </button>
      ) : (
        <button type="button" className="wt-primary wt-next" disabled={busy} onClick={onNext}>
          {step === 1 ? 'Get started' : 'Next'}
        </button>
      )}
    </footer>
  );
}
