/**
 * Where an app install stands, read from its connection row: the three steps the install card
 * shows (Checking it, Connecting, Signing in), the card's view for each status, and the prompts
 * to try when it ends. The chat's card and Connections' installing row both read it, so the two
 * never say different things. Contains appView, appWorking, findApp, promptsFor, stepsAt,
 * subjectOfRow and APP_STEPS. An expert install has no steps of its own: the brain says which
 * stage it is in (and a percent while it downloads), and expertWorking and stageWords put that in
 * words for the chat's card and Connections. Also holds expertWorking and stageWords.
 */
import type { AppInfo, AppRow } from '../shapes';
import { JOB_KINDS } from '../jobs-kinds';
import type { InstallStep, InstallSubject, InstallView } from './install-card';

const STAGES: Record<string, string> = {
  checking: 'Checking this computer',
  node: 'Getting what it needs to run',
  resolving: 'Finding the right version',
  fetching: 'Downloading its files',
  finishing: 'Setting it up',
  downloading: 'Downloading',
  extracting: 'Unpacking',
  done: 'Finishing up',
};

/** The stage in plain words; a stage the UI does not know is just "Working". */
export function stageWords(progress: { stage: string }): string {
  return STAGES[progress.stage] ?? 'Working';
}

/** The card's Working view for an expert install, from the brain's stage and optional percent. */
export function expertWorking(progress: {
  stage: string;
  percent?: number | undefined;
}): Extract<InstallView, { phase: 'working' }> {
  return {
    phase: 'working',
    label: `${stageWords(progress)}…`,
    ...(progress.percent !== undefined ? { percent: progress.percent } : {}),
  };
}

export const APP_STEPS = ['Checking it', 'Connecting', 'Signing in'] as const;
/** What each step failing means, in the words of "Notion didn't …". */
const FAILED_WORDS = ['finish checking', 'finish connecting', 'finish signing in'] as const;

/** The steps with the first `at` done and step `at` now (or failed). */
export const stepsAt = (at: number, failed: boolean): InstallStep[] =>
  APP_STEPS.map((label, i) => ({
    label,
    state: i < at ? 'done' : i === at ? (failed ? 'fail' : 'now') : 'todo',
  }));

/** The connection row for the app an install card is about, by id or name. */
export const findApp = (apps: AppInfo[], s: InstallSubject): AppInfo | undefined => {
  const slug = s.id.toLowerCase();
  return apps.find(
    (a) =>
      a.id.toLowerCase() === slug ||
      a.name.toLowerCase() === s.name.toLowerCase() ||
      slug.includes(a.id.toLowerCase()),
  );
};

/** A registry row as an install card's subject, for the Connections page. */
export const subjectOfRow = (row: AppRow): InstallSubject => ({
  kind: 'app',
  id: row.id,
  name: row.name,
  official: row.official,
});

/** The everyday jobs that need this app: the only per-app prompts the UI knows. */
export const promptsFor = (s: InstallSubject): string[] =>
  JOB_KINDS.filter(
    (job) =>
      job.app !== undefined &&
      (s.id.toLowerCase().includes(job.app.key) || s.name.toLowerCase().includes(job.app.key)),
  )
    .slice(0, 2)
    .map((job) => job.label);

/** The card's Working view for a row that is not done or failed (none yet: checking). */
export function appWorking(row: AppInfo | undefined): Extract<InstallView, { phase: 'working' }> {
  if (row?.status === 'needs-sign-in') {
    return { phase: 'working', steps: stepsAt(2, false), note: 'Your browser opened to sign in.' };
  }
  return { phase: 'working', steps: stepsAt(row === undefined ? 0 : 1, false) };
}

/**
 * What an app install looks like right now, from its connection row, and how far it got (0 to 2).
 * `furthest` is the furthest step seen so far: a failure stops there.
 */
export function appView(
  row: AppInfo | undefined,
  s: InstallSubject,
  furthest: number,
): [InstallView, number] {
  if (row === undefined) return [appWorking(undefined), 0];
  if (row.status === 'connected') {
    return [
      { phase: 'done', tools: row.tools.map((tool) => tool.name), tryPrompts: promptsFor(s) },
      2,
    ];
  }
  if (row.status === 'error') {
    return [
      {
        phase: 'failed',
        error: `${s.name} didn't ${FAILED_WORDS[furthest] ?? FAILED_WORDS[1]}. Nothing was connected.`,
        steps: stepsAt(furthest, true),
      },
      furthest,
    ];
  }
  return [appWorking(row), row.status === 'needs-sign-in' ? 2 : 1];
}
