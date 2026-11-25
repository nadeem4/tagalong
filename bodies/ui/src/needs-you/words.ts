/** The words for each kind of request, shared by the bubble card and Home's rows. */
import { AI_TOOLS, aiToolLabel } from '../shapes/ai-tools';
import type { NeedsYouItem } from '../shapes';

/** `claude-code` reads "Claude Code"; an id the app does not know is title-cased. */
export const expertName = (id: string | undefined): string => {
  if (id === undefined) return 'The expert';
  return AI_TOOLS.some((tool) => tool.id === id)
    ? aiToolLabel(id)
    : id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/** A brain's name opening a sentence: only the unnamed fallback needs a capital. */
export const brainFirst = (name: string): string => (name === 'your brain' ? 'Your brain' : name);

export const brainLabel = (item: NeedsYouItem): string =>
  item.identity === undefined ? item.brain : `${item.brain} (${item.identity})`;

const askedBy = (item: NeedsYouItem): string =>
  `Asked by ${brainLabel(item)}${item.path === null ? '' : ` · ${item.path}`}`;

interface NeedWords {
  /** The row's title in Home. */
  title: (item: NeedsYouItem) => string;
  /** The bubble card's heading. */
  head: (item: NeedsYouItem) => string;
  /** What the person is told once they have said yes. */
  allowed: (item: NeedsYouItem) => string;
  working: string;
  /** Shown on the card while it waits on something outside this PC. */
  waiting?: (item: NeedsYouItem) => string;
  /** The button that does it. */
  does: string;
  /** The row's second line while it waits. */
  meta: (item: NeedsYouItem) => string;
}

export const WORDS: Record<NeedsYouItem['need'], NeedWords> = {
  approve: {
    title: (i) => `Run ${i.what}`,
    head: (i) => `Scout on ${i.brain} wants to run ${i.what} here.`,
    allowed: (i) => `Allowed. ${i.brain} can run ${i.what}. Starting the job now.`,
    working: 'Allowing it…',
    does: 'Allow',
    meta: askedBy,
  },
  signin: {
    title: (i) => `Sign in to ${expertName(i.expert)}`,
    head: (i) => `${expertName(i.expert)} needs you to sign in on this PC.`,
    allowed: (i) =>
      `Signed in to ${expertName(i.expert)} on this PC. Running the job for ${i.brain}.`,
    working: 'Waiting for you to finish in the browser.',
    does: 'Sign in',
    meta: askedBy,
  },
  app_signin: {
    title: (i) => `Finish signing in to ${i.what}`,
    head: (i) => `Finish signing in to ${i.what}.`,
    allowed: (i) => `${i.what} is signed in on ${i.brain}. You can close the browser tab.`,
    working: 'Passing it on…',
    waiting: (i) => `Waiting for ${i.what}.`,
    does: 'Open it again',
    meta: () => 'Waiting for the sign-in page in your browser.',
  },
};

export const PUT_OFF =
  'Okay, I have not run anything. The job waits, and the question is in Home under Needs you on this PC.';
