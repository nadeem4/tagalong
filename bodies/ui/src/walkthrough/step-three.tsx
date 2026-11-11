/**
 * Walkthrough step 3: the five everyday moments, each with what you say and what Scout does.
 * Static text, nothing to press. Contains StepThree.
 */

import { MOMENTS } from './moments';

export function StepThree() {
  return (
    <section>
      <span className="wt-label">What to ask</span>
      <h1>Everyday things, said plainly</h1>
      <p className="wt-lead">
        Select text or press the ask key, then say it the way you would to a colleague.
      </p>
      <ul className="tg-card wt-moments">
        {MOMENTS.map((moment) => (
          <li key={moment.ask}>
            <span className="wt-where">{moment.where}</span>
            <div>
              <q>{moment.ask}</q>
              <p className="wt-help">{moment.outcome}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
