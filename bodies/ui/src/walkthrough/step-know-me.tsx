/**
 * Walkthrough step 10: let Scout get to know you. The shared get-to-know-me flow, skippable and
 * never blocking Next: the run goes on in the brain if the person moves on. Contains StepKnowMe.
 */

import { KnowMeFlow } from '../know-me/know-me-flow';

export function StepKnowMe() {
  return (
    <section>
      <span className="wt-label">Get to know you</span>
      <h1>Let Scout get to know you</h1>
      <p className="wt-lead">Scout reads only public pages and the file you pick.</p>
      <p className="wt-help">
        It keeps just the facts it can quote, so what it remembers is yours to check and delete.
      </p>
      <div className="wt-know">
        <KnowMeFlow
          runningNote="You can move on; Scout keeps reading and saves what it finds."
          doneNote="Saved. You can run this again any time in Home, under Memory."
        />
      </div>
    </section>
  );
}
