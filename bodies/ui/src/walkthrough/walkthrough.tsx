/**
 * The first-run walkthrough: Scout's navy side with the step list, one step on the off-white
 * page, and the footer. Contains Walkthrough. Next saves what the step staged; Back, Skip for
 * now and the side list save nothing; only Finish and Skip tour mark the tour seen.
 */

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BeanClipData } from '../theme/bean-clip';
import { Footer } from './footer';
import { SidePanel } from './side-panel';
import { StepFive } from './step-five';
import { StepFour } from './step-four';
import { StepOne } from './step-one';
import { StepThree } from './step-three';
import { StepTwo } from './step-two';
import { KEY_STEP, STEPS, skipTour } from './steps';
import { StepSaveContext } from './use-step-save';
import type { Save } from './use-step-save';
import type { WalkthroughHost } from './walkthrough-host';
import { WALKTHROUGH_CSS } from './walkthrough-styles';

interface WalkthroughProps {
  host: WalkthroughHost;
  /** Bean's idle strip, drawn still in the side panel. */
  scout: BeanClipData;
  /** The step to open at (the no-key button opens the key step). */
  initialStep?: number;
}

/** Steps 6 to 9 are built in the next slice. */
function Soon({ step }: { step: number }): ReactNode {
  const title = STEPS.find((candidate) => candidate.id === step)?.title ?? '';
  return (
    <section>
      <h1>{title}</h1>
      <p className="wt-lead">This step is coming in the next update.</p>
    </section>
  );
}

function body(step: number, host: WalkthroughHost): ReactNode {
  switch (step) {
    case 1:
      return <StepOne />;
    case 2:
      return <StepTwo />;
    case 3:
      return <StepThree />;
    case 4:
      return <StepFour host={host} />;
    case 5:
      return <StepFive host={host} />;
    default:
      return <Soon step={step} />;
  }
}

export function Walkthrough({ host, scout, initialStep = 1 }: WalkthroughProps) {
  const first = initialStep >= 1 && initialStep <= STEPS.length ? initialStep : 1;
  const [current, setCurrent] = useState(first);
  // Steps before the one opened at count as reached, so the list can go back over them.
  const [reached, setReached] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = useRef<Save | null>(null);

  function go(step: number): void {
    setCurrent(step);
    setReached((now) => Math.max(now, step));
    setError('');
  }

  async function next(): Promise<void> {
    setBusy(true);
    try {
      await save.current?.();
      go(Math.min(current + 1, STEPS.length));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function leave(): Promise<void> {
    // Asked at the click, not remembered: the key may have been added a moment ago.
    const hasKey = await host.keyStatus().then(
      (status) => status.hasKey,
      () => false,
    );
    const outcome = skipTour(hasKey);
    if (outcome === 'close') await host.finishWalkthrough();
    else go(outcome.goTo);
  }

  return (
    <div className="wt">
      <style>{WALKTHROUGH_CSS}</style>
      <SidePanel scout={scout} current={current} reached={reached} onJump={go} />
      <main className="wt-page">
        <div className="wt-body" key={current}>
          <StepSaveContext.Provider value={(next) => (save.current = next)}>
            {body(current, host)}
          </StepSaveContext.Provider>
        </div>
        <Footer
          step={current}
          busy={busy}
          error={error}
          onBack={() => go(Math.max(current - 1, 1))}
          onNext={() => void next()}
          onSkipStep={() => go(Math.min(current + 1, KEY_STEP))}
          onSkipTour={() => void leave()}
        />
      </main>
    </div>
  );
}
