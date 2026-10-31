/**
 * Walkthrough step 3: six everyday things to ask, and who handles each. Text only. Contains
 * StepThree. Words are the spec's step copy.
 */

const EXAMPLES: readonly { where: string; ask: string; how: string }[] = [
  {
    where: 'VS Code · a failing test',
    ask: 'Fix this test and tell me what was wrong.',
    how: 'Claude Code gets a brief for that folder. You read it and press Send.',
  },
  {
    where: 'Chrome · a pricing page',
    ask: 'Which plan fits a team of five?',
    how: 'Scout reads the page you’re on and answers beside it.',
  },
  {
    where: 'Any window',
    ask: 'Remind me in 20 minutes to call Sam.',
    how: 'Scout sets a timer and says it out loud when it’s time.',
  },
  {
    where: 'A job is running',
    ask: 'Tell me when the job finishes.',
    how: 'Scout lets you know the moment Claude Code is done, with what it changed.',
  },
  {
    where: 'Notion · connected',
    ask: 'Add this article to my reading list.',
    how: 'Notion gets the change only after you choose Allow once.',
  },
  {
    where: 'Two screens',
    ask: "What's on my other screen?",
    how: 'Scout checks the window list, without taking a screenshot.',
  },
];

export function StepThree() {
  return (
    <section>
      <h1>Things you can ask</h1>
      <p className="wt-lead">
        Ask the way you’d ask someone sitting next to you. A few everyday ones:
      </p>
      <ul className="wt-examples">
        {EXAMPLES.map((example) => (
          <li key={example.ask}>
            <span className="wt-label">{example.where}</span>
            <q>{example.ask}</q>
            <p className="wt-help">{example.how}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
