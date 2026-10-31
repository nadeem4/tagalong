/**
 * The first-run walkthrough: Scout's navy side with the step list, one step on the off-white
 * page, and the footer. Contains Walkthrough. Next saves what the step staged; Back, Skip for
 * now and the side list save nothing; only Finish and Skip tour mark the tour seen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BeanClipData } from '../theme/bean-clip';
import { FinishCard } from './finish-card';
import { Footer } from './footer';
import { SidePanel } from './side-panel';
import { showAccelerator, StepFour } from './step-four';
import { StepEight } from './step-eight';
import { StepFive, TALK_KEYS } from './step-five';
import { StepNine } from './step-nine';
import { StepOne } from './step-one';
import { StepSeven } from './step-seven';
import { StepSix } from './step-six';
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

function body(step: number, host: WalkthroughHost, onValid: (valid: boolean) => void): ReactNode {
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
    case 6:
      return <StepSix host={host} />;
    case 7:
      return <StepSeven host={host} />;
    case 8:
      return <StepEight host={host} />;
    default:
      return <StepNine host={host} onValid={onValid} />;
  }
}

/** The ask and talk keys as the finish card shows them; the defaults if settings can't be read. */
async function finishKeys(host: WalkthroughHost): Promise<{ ask: string; talk: string }> {
  try {
    const { hotkeys } = await host.getSettings();
    const talk = hotkeys.talk ?? 'RightControl';
    return {
      ask: showAccelerator(hotkeys.ask),
      talk: TALK_KEYS.find((key) => key.value === talk)?.label ?? talk,
    };
  } catch {
    return { ask: 'Ctrl+Shift+Space', talk: 'Right Ctrl' };
  }
}

export function Walkthrough({ host, scout, initialStep = 1 }: WalkthroughProps) {
  const first = initialStep >= 1 && initialStep <= STEPS.length ? initialStep : 1;
  const [current, setCurrent] = useState(first);
  // Steps before the one opened at count as reached, so the list can go back over them.
  const [reached, setReached] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyValid, setKeyValid] = useState(false);
  const [finishKeysShown, setFinishKeysShown] = useState<{ ask: string; talk: string } | null>(
    null,
  );
  const closing = useRef(false);
  const save = useRef<Save | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  // A step change moves focus to the new headline, so a keyboard or screen reader follows it.
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    const heading = bodyRef.current?.querySelector('h1');
    if (heading == null) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [current]);

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

  async function finish(): Promise<void> {
    setBusy(true);
    setFinishKeysShown(await finishKeys(host));
    setBusy(false);
  }

  // Close and Open Home both end the tour; a second click while the window closes does nothing.
  async function close(openHome: boolean): Promise<void> {
    if (closing.current) return;
    closing.current = true;
    try {
      if (openHome) await host.openHome().catch(() => undefined);
      await host.finishWalkthrough();
    } finally {
      closing.current = false;
    }
  }

  const onValid = useCallback((valid: boolean) => setKeyValid(valid), []);

  return (
    <div className="wt">
      <style>{WALKTHROUGH_CSS}</style>
      <SidePanel scout={scout} current={current} reached={reached} onJump={go} />
      <main className="wt-page">
        {finishKeysShown !== null ? (
          <FinishCard
            askKey={finishKeysShown.ask}
            talkKey={finishKeysShown.talk}
            onOpenHome={() => void close(true)}
            onClose={() => void close(false)}
          />
        ) : (
          <>
            <div className="wt-body" key={current} ref={bodyRef}>
              <StepSaveContext.Provider value={(next) => (save.current = next)}>
                {body(current, host, onValid)}
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
              canFinish={keyValid}
              onFinish={() => void finish()}
            />
          </>
        )}
      </main>
    </div>
  );
}
