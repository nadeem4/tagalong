/**
 * The bubble's live card for a running job ("Claude Code is working", the step, a link to Tasks): a
 * hook that reads the newest running step from the brain, and the card that shows it. Step title
 * only, never output, shown whole; not Scout's voice, so it is never spoken.
 * Contains useRunningStep and JobLine.
 */
import { useEffect, useState } from 'react';
import type { HostBridge, RunningStep } from './host-bridge';
import { Icon } from './setup/icons';

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

/**
 * A running job as a card: the job's title (else who is working), a link to Tasks, the step in
 * body type with only a command in code, and, in the full chat only (`bar`), a moving bar.
 */
export function JobLine({
  step,
  onOpenTasks,
  bar = false,
}: {
  step: RunningStep;
  onOpenTasks: () => void;
  bar?: boolean;
}) {
  const title = step.title ?? '';
  // A step from an older brain has no kind; its text is the command.
  const command = step.kind === undefined || step.kind === 'command';
  return (
    <div className="bubble-jobline" data-testid="job-line" aria-live="off">
      <div className="bubble-jobline-top">
        <span className="bubble-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b>{title !== '' ? title : step.expert}</b>
        <button type="button" className="bubble-link" onClick={onOpenTasks}>
          Open in Tasks
          <Icon name="chevRight" />
        </button>
      </div>
      {/* The brain reports no share done, so the bar only says the job is moving. */}
      {bar && (
        <div className="bubble-jobbar" role="progressbar" aria-label="Working">
          <i />
        </div>
      )}
      <p className="bubble-jobline-step">
        {command ? (
          <>
            Running <code>{step.text}</code>
          </>
        ) : (
          step.text
        )}
      </p>
    </div>
  );
}
