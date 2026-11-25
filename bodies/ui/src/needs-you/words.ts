/** The words for each kind of request, shared by the bubble card and Home's rows. */
import { expertName } from '../shapes/ai-tools';
import type { NeedsYouItem } from '../shapes';

/** A brain's name opening a sentence: only the unnamed fallback needs a capital. */
export const brainFirst = (name: string): string => (name === 'your brain' ? 'Your brain' : name);

export const brainLabel = (item: NeedsYouItem): string =>
  item.identity === undefined ? item.brain : `${item.brain} (${item.identity})`;

/** What a request is about: an expert by its name, else the program or address as given. */
export const target = (item: NeedsYouItem): string =>
  item.expert === undefined ? item.what : expertName(item.expert);

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
    title: (i) => `Run ${target(i)}`,
    head: (i) => `Scout on ${i.brain} wants to run ${target(i)} here.`,
    allowed: (i) => `Allowed. ${i.brain} can run ${target(i)}. Starting the job now.`,
    working: 'Allowing it…',
    does: 'Allow',
    meta: askedBy,
  },
  install: {
    title: (i) => `Install ${expertName(i.expert)}`,
    head: (i) => `${expertName(i.expert)} is not on this PC yet.`,
    allowed: (i) =>
      `${expertName(i.expert)} is installed on this PC. Running the job for ${i.brain}.`,
    working: 'Installing. This can take a few minutes.',
    waiting: (i) => `${brainFirst(i.brain)} wants it here. Install it?`,
    does: 'Install',
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

export const PUT_OFF = 'Okay, I have not run anything. The job stops.';
