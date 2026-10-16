/**
 * Welcome's step machine (the first-run setup window, onboarding.tsx), kept apart from React
 * so it is tested in plain Node: where setup opens or resumes, how an answer moves it on, and
 * what each answer saves. Contains FirstRun, stepsFor, startFirstRun, answered, goTo, chipState,
 * listensNow, oneAtATime and answerPatch. Answers are matched in first-run-match.ts and worded
 * in first-run-lines.ts; no AI steers any of it.
 */
import { WELCOME_STEPS } from '@tagalong/protocol';
import type { Settings, SettingsPatch, WelcomeStep } from '@tagalong/protocol';

/** Where setup is: the steps, the one on screen, and the furthest one reached (saved, so setup resumes there). */
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

/**
 * Setup listens only once "Talk to me" was chosen in this run (or a resumed one), and never
 * on Try it. Past the Answer step is what keeps a re-run of a finished setup from listening
 * before you choose again: it reopens with Answer as the furthest step reached.
 */
export function listensNow(run: FirstRun, settings: Settings): boolean {
  return (
    run.steps.includes('answer') &&
    settings.welcome.answerBy === 'talk' &&
    indexOf(run, run.reached) > indexOf(run, 'answer') &&
    run.current !== 'try'
  );
}

/**
 * Runs steps one at a time, each after the one before has settled, failed or not. Setup's
 * saves go through one, so each patch is built from the settings the last save returned.
 */
export function oneAtATime(): <T>(step: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (step) => {
    const next = last.then(step);
    last = next.catch(() => undefined);
    return next;
  };
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
