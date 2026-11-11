/**
 * Walkthrough step 1: the pitch, one companion for everything you do, shown as a day with
 * Scout (three of the five moments). Static, no host calls. Contains StepOne.
 */

import { MOMENTS } from './moments';

/** Morning, mid-day, anywhere: the first, second and last moment. */
const DAY = MOMENTS.filter((_, index) => index === 0 || index === 1 || index === 4);

export function StepOne() {
  return (
    <section>
      <span className="wt-label">Welcome</span>
      <h1>One companion for everything you do</h1>
      <p className="wt-lead">
        Scout lives on your screen. Ask it anything, any time, and it works with whatever you
        already have open.
      </p>
      <div className="tg-card wt-day">
        <span className="wt-label">A day with Scout</span>
        <ul>
          {DAY.map((moment) => (
            <li key={moment.ask}>
              <span className="wt-where">{moment.where}</span>
              <q>{moment.ask}</q>
              <p className="wt-help">{moment.outcome}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className="wt-note wt-note--plain">
        It takes about two minutes. The last step needs an Anthropic API key, so keep your account
        handy.
      </p>
    </section>
  );
}
