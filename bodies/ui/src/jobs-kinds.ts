/**
 * The everyday jobs the tour and Home talk about, and the one app each needs. The one place a job
 * label meets an app, so the tour's app rows and Home's job labels cannot drift apart.
 * Contains JOB_KINDS, EXPERT_JOB, DEFAULT_EXPERT_JOB and the JobKind type. Static screen copy, never Scout's words.
 */

export interface JobKind {
  /** What the person would say. */
  label: string;
  /** One plain line under it. */
  help: string;
  /** The app the job needs: `key` is matched (lowercase, contained) against registry and app names. */
  app?: { key: string; name: string };
}

export const JOB_KINDS: readonly JobKind[] = [
  {
    label: 'Draft replies to my inbox',
    help: 'Scout reads your mail and writes the replies. You read them before anything is sent.',
    app: { key: 'gmail', name: 'Gmail' },
  },
  {
    label: 'Plan my day around my calendar',
    help: 'Scout looks at what is on and finds the gaps.',
    app: { key: 'calendar', name: 'Google Calendar' },
  },
  {
    label: 'Research this and write me a summary',
    help: 'Scout searches the web, reads the pages and gives you the short version.',
  },
  {
    label: 'Tidy this folder',
    help: 'Scout lists, reads and moves files in the folders you name. It asks before it deletes.',
  },
  {
    label: 'Fix this code',
    help: 'A long, many-step job. Scout hands it to an expert, which you can set up on the last step.',
  },
];

/** Home's expert rows: the kind of job first, the product underneath. */
export const EXPERT_JOB: Readonly<Record<string, string>> = {
  'claude-acp': 'Fix code and other long jobs',
};
export const DEFAULT_EXPERT_JOB = 'Long, many-step jobs';
