/**
 * Walkthrough step 2: how it fits together (you, Scout, experts, shared apps). Contains
 * StepTwo. Words are the spec's step copy.
 */

const EXPERTS: readonly { name: string; when: 'Now' | 'Coming' | 'Later' }[] = [
  { name: 'Claude Code', when: 'Now' },
  { name: 'Gemini CLI', when: 'Coming' },
  { name: 'Codex', when: 'Coming' },
  { name: 'Other coding agents', when: 'Coming' },
  { name: 'Model APIs, tool servers', when: 'Later' },
];

const APPS = ['Notion', 'GitHub', 'Linear', 'Any MCP server'];

export function StepTwo() {
  return (
    <section>
      <h1>How it fits together</h1>
      <p className="wt-lead">
        You talk to one companion. Scout works out who should do the job, hands it over and brings
        the answer back, so you never switch tabs to reach the rest.
      </p>
      <div className="wt-cols">
        <div>
          <figure
            className="wt-card"
            style={{ margin: 0 }}
            aria-label="You ask Scout. Scout sends a brief to an expert, and the result comes back to you."
          >
            <h3>You</h3>
            <p className="wt-help">Any window, Your browser, Your voice</p>
            <p className="wt-help">ask, then answer</p>
            <h3>Companion</h3>
            <p className="wt-help">Scout routes the work</p>
            <p className="wt-help">brief, then result</p>
            <h3>Experts</h3>
          </figure>
        </div>
        <div>
          <span className="wt-label">Experts</span>
          <ul className="wt-rows">
            {EXPERTS.map((expert) => (
              <li key={expert.name}>
                <span>{expert.name}</span>
                <span className={expert.when === 'Now' ? 'wt-tag wt-tag--now' : 'wt-tag'}>
                  {expert.when}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ul className="wt-facts" style={{ marginTop: 24, maxWidth: 640 }}>
        <li>
          <h3>Home</h3>
          <p>Every job, connection and approval in one place.</p>
        </li>
        <li>
          <h3>Connected apps</h3>
          <p>Shared by Scout and the experts.</p>
          <ul className="wt-chips">
            {APPS.map((app) => (
              <li key={app} className="wt-tag">
                {app}
              </li>
            ))}
          </ul>
        </li>
        <li>
          <h3>You ask once</h3>
          <p>From the window you’re in, the browser, or out loud.</p>
        </li>
        <li>
          <h3>Scout routes</h3>
          <p>It answers small things itself and briefs an expert for real work.</p>
        </li>
        <li>
          <h3>Nothing goes unseen</h3>
          <p>Each hand-off waits for your Send. Home shows them all.</p>
        </li>
      </ul>
    </section>
  );
}
