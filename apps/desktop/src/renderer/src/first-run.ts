import { WELCOME_STEPS } from '@tagalong/protocol';
import type { Settings, SettingsPatch, WelcomeStep } from '@tagalong/protocol';

/**
 * The guided first run as a pure state machine: which steps this computer offers, the one
 * on screen, and the furthest one reached (saved, so setup resumes there). No AI steers it:
 * every answer is a fixed choice, matched in `first-run-match.ts`.
 */
export interface FirstRun {
  steps: readonly WelcomeStep[];
  current: WelcomeStep;
  reached: WelcomeStep;
}

export type FirstRunAnswer =
  | { step: 'answer'; by: 'talk' | 'type' }
  | { step: 'name'; name: string }
  | { step: 'think'; brain: string }
  | { step: 'voice'; talk: boolean }
  | { step: 'keys' };

/** How to answer is asked only when setup can listen; otherwise typing and taps are the way. */
export function stepsFor(canListen: boolean): WelcomeStep[] {
  return WELCOME_STEPS.filter((step) => canListen || step !== 'answer');
}

const indexOf = (run: FirstRun, step: WelcomeStep): number => run.steps.indexOf(step);
const later = (run: FirstRun, a: WelcomeStep, b: WelcomeStep): WelcomeStep =>
  indexOf(run, a) >= indexOf(run, b) ? a : b;

/** "Rather not" means the name is never asked again: setup steps past it on its own. */
function pastDeclinedName(run: FirstRun, declined: boolean): FirstRun {
  if (!declined || run.current !== 'name') return run;
  const current = run.steps[indexOf(run, 'name') + 1] ?? run.current;
  return { ...run, current, reached: later(run, current, run.reached) };
}

/** Where setup opens: the step reached last time, or the top for a new or finished setup. */
export function startFirstRun(settings: Settings, canListen: boolean): FirstRun {
  const steps = stepsFor(canListen);
  const first = steps[0] ?? 'name';
  const saved = settings.welcome.step;
  const start =
    !settings.welcome.done && saved !== undefined && steps.includes(saved) ? saved : first;
  return pastDeclinedName({ steps, current: start, reached: start }, settings.userNameDeclined);
}

/** An answer moves setup on by itself: to the next step, or back to where you had got to. */
export function answered(run: FirstRun, nameDeclined: boolean): FirstRun {
  const wentBack = indexOf(run, run.current) < indexOf(run, run.reached);
  const current = wentBack
    ? run.reached
    : (run.steps[indexOf(run, run.current) + 1] ?? run.current);
  return pastDeclinedName(
    { ...run, current, reached: later(run, current, run.reached) },
    nameDeclined,
  );
}

/** A step chip: only a step already reached opens. */
export function goTo(run: FirstRun, step: WelcomeStep): FirstRun {
  const at = indexOf(run, step);
  return at >= 0 && at <= indexOf(run, run.reached) ? { ...run, current: step } : run;
}

export function chipState(run: FirstRun, step: WelcomeStep): 'current' | 'done' | 'ahead' {
  if (step === run.current) return 'current';
  return indexOf(run, step) <= indexOf(run, run.reached) ? 'done' : 'ahead';
}

/**
 * What one answer saves, at once and as given. The whole `welcome` record is rebuilt from
 * the current one, because a patch replaces it: `done` is never undone here.
 */
export function answerPatch(
  answer: FirstRunAnswer,
  settings: Settings,
  after: FirstRun,
): SettingsPatch {
  const welcome = (change: Partial<Settings['welcome']> = {}): Settings['welcome'] => ({
    ...settings.welcome,
    ...change,
    done: settings.welcome.done,
    step: after.reached,
  });
  switch (answer.step) {
    case 'answer':
      return { welcome: welcome({ answerBy: answer.by }) };
    case 'name':
      return answer.name === ''
        ? { userName: '', userNameDeclined: true, welcome: welcome() }
        : { userName: answer.name, userNameDeclined: false, welcome: welcome() };
    case 'think':
      return { welcome: welcome({ brain: answer.brain }) };
    case 'voice':
      return { voice: { ...settings.voice, enabled: answer.talk }, welcome: welcome() };
    case 'keys':
      return { welcome: welcome() };
  }
}
