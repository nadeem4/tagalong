/**
 * Walkthrough step 6: the everyday jobs Scout does, explained and nothing more. Connecting the
 * apps and the expert they need happens on the last step, so this one has no buttons.
 * Contains StepSix. Words are the step's own.
 */

import { JOB_KINDS } from '../jobs-kinds';

export function StepSix() {
  return (
    <section>
      <span className="wt-label">Everyday jobs</span>
      <h1>Scout does the everyday jobs</h1>
      <p className="wt-lead">
        Say what you need. Scout uses your apps for it and asks before anything leaves this
        computer. You can connect your tools at the end of the tour, or any time in Home.
      </p>
      <ul className="tg-card wt-jobs">
        {JOB_KINDS.map((job) => (
          <li key={job.label} className="wt-job">
            <div className="wt-job__text">
              <h3>{job.label}</h3>
              <p className="wt-help">{job.help}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
