/**
 * The five everyday moments the walkthrough teaches with: where you are, what you say and
 * what Scout does. Steps 1 (three of them) and 3 (all five) read from here so the copy is
 * written once. Contains MOMENTS.
 */

export interface Moment {
  where: string;
  ask: string;
  outcome: string;
}

export const MOMENTS: readonly Moment[] = [
  {
    where: 'At 9:00',
    ask: 'What’s on today?',
    outcome: 'Reads your calendar, sums it up and offers reminders.',
  },
  {
    where: 'Reading a long email',
    ask: 'Say no to Thursday, kindly',
    outcome: 'Drafts the reply beside it, from the text you selected.',
  },
  {
    where: 'On a pricing page',
    ask: 'Which plan fits a team of five?',
    outcome: 'Reads the page and answers.',
  },
  {
    where: 'A bug in your project',
    ask: 'Fix this failing test',
    outcome: 'Hands it to an expert and tells you when it’s done.',
  },
  {
    where: 'Anywhere',
    ask: 'Remind me in 20 minutes to call Sam',
    outcome: 'Sets a timer and says it out loud.',
  },
];
