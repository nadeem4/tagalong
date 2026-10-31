/**
 * The walkthrough's footer on every step: Back, Next (Finish on the last step, off until the
 * key step turns it on), Skip for now (the step's own skip) and Skip tour. Contains Footer.
 */

import { STEPS } from './steps';

interface FooterProps {
  step: number;
  busy: boolean;
  error: string;
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipTour: () => void;
}

export function Footer({ step, busy, error, onBack, onNext, onSkipStep, onSkipTour }: FooterProps) {
  const info = STEPS.find((candidate) => candidate.id === step);
  const last = step === STEPS.length;
  return (
    <footer className="wt-footer">
      <button type="button" className="wt-quiet" disabled={step === 1 || busy} onClick={onBack}>
        Back
      </button>
      {error !== '' && (
        <p className="wt-error" role="alert">
          {error}
        </p>
      )}
      <span className="wt-spacer" />
      <button type="button" className="wt-text" disabled={busy} onClick={onSkipTour}>
        Skip tour
      </button>
      {info?.skippable === true && (
        <button type="button" className="wt-quiet" disabled={busy} onClick={onSkipStep}>
          Skip for now
        </button>
      )}
      {last ? (
        <button type="button" className="wt-primary" disabled>
          Finish
        </button>
      ) : (
        <button type="button" className="wt-primary" disabled={busy} onClick={onNext}>
          Next
        </button>
      )}
    </footer>
  );
}
