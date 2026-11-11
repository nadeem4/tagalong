/**
 * The bubble's one live line for a running job ("Claude Code: npm init -y"): a hook that reads
 * the newest running step from the brain, and the muted row that shows it. Step title only,
 * never output, shown whole; not Scout's voice, so it is never spoken.
 * Contains useRunningStep and JobLine.
 */
import { useEffect, useState } from 'react';
import type { HostBridge, RunningStep } from './host-bridge';

/** At most one read per window, as the brain's own `job_activity` notices are throttled. */
const READ_EVERY_MS = 250;

/** The most recently updated running job's current step, or null (also when the brain is away). */
export function useRunningStep(bridge: HostBridge): RunningStep | null {
  const [step, setStep] = useState<RunningStep | null>(null);

  useEffect(() => {
    let alive = true;
    // A slow older reply must not overwrite a newer one.
    let seq = 0;
    let lastRead = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      lastRead = Date.now();
      const mine = ++seq;
      bridge.runningSteps().then(
        (steps) => {
          if (alive && mine === seq) setStep(steps[0] ?? null);
        },
        (error: unknown) => {
          console.error('could not read running steps', error);
          if (alive && mine === seq) setStep(null);
        },
      );
    };
    read();
    const off = bridge.onBrainChanged((what) => {
      if (what !== 'job_activity' && what !== 'jobs') return;
      if (timer !== undefined) return;
      const wait = lastRead + READ_EVERY_MS - Date.now();
      if (wait <= 0) read();
      else
        timer = setTimeout(() => {
          timer = undefined;
          read();
        }, wait);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, [bridge]);

  return step;
}

export function JobLine({ step }: { step: RunningStep }) {
  // The whole step wraps in mono; a title would only repeat it.
  return (
    <p className="bubble-status bubble-jobline" data-testid="job-line" aria-live="off">
      {step.expert}: <code>{step.text}</code>
    </p>
  );
}
