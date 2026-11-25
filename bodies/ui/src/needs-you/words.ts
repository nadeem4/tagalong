/** The words for each kind of request, shared by the bubble card and Home's rows. */
import type { NeedsYouItem } from '../shapes';

/** `claude-code` reads "Claude Code". */
export const expertName = (id: string | undefined): string =>
  (id ?? 'The expert').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A brain's name starts a sentence: `your brain` reads `Your brain`. */
export const upFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const WORKING: Record<NeedsYouItem['need'], string> = {
  approve: 'Allowing it…',
  install: 'Installing…',
  signin: 'Waiting for you to finish in the browser.',
};

export const DO: Record<NeedsYouItem['need'], string> = {
  approve: 'Allow',
  install: 'Install',
  signin: 'Sign in',
};

/** One line saying what the request is, for Home's rows. */
export function title(item: NeedsYouItem): string {
  if (item.need === 'install') return `Install ${expertName(item.expert)} on this PC`;
  if (item.need === 'signin') return `Sign in to ${expertName(item.expert)}`;
  return `Run ${item.what}`;
}

/** What the person is told once they have chosen. */
export const ALLOWED = (item: NeedsYouItem): string =>
  item.need === 'approve'
    ? `Allowed. ${item.brain} can run ${item.what}. Starting the job now.`
    : item.need === 'install'
      ? `${expertName(item.expert)} is installed on this PC. Starting the job now.`
      : `Signed in to ${expertName(item.expert)} on this PC. Running the job for ${item.brain}.`;

export const PUT_OFF =
  'Okay, I have not run anything. The job waits, and the question is in Home under Needs you on this PC.';
