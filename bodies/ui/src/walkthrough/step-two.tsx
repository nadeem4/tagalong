/**
 * Walkthrough step 2: how a request travels. You ask, Scout answers itself, uses your apps
 * or brings in an expert, and the result comes back where you are. Static; the arrows are
 * CSS. Contains StepTwo.
 */

const ROUTES: readonly { name: string; detail: string }[] = [
  { name: 'Answers itself', detail: 'Questions and drafts' },
  { name: 'Uses your apps', detail: 'Calendar, notes, issues' },
  { name: 'Brings in an expert', detail: 'For long jobs' },
];

const APPS = ['Notion', 'GitHub', 'Linear', 'Google Calendar', 'Any MCP server'];

export function StepTwo() {
  return (
    <section>
      <span className="wt-label">How it works</span>
      <h1>Ask, and Scout finds the way</h1>
      <p className="wt-lead">
        You ask in your own words. Scout picks the best route and brings the answer back to where
        you already are.
      </p>
      <ol className="wt-flow" aria-label="How a request travels">
        <li className="tg-card wt-node">
          <span className="wt-label">You ask</span>
          <strong>By voice or text</strong>
        </li>
        <li className="wt-hub">
          <span className="tg-wordmark">Scout</span>
        </li>
        <li>
          <ul className="wt-routes" aria-label="Ways Scout helps">
            {ROUTES.map((route) => (
              <li key={route.name} className="tg-card wt-node">
                <strong>{route.name}</strong>
                <span className="wt-help">{route.detail}</span>
              </li>
            ))}
          </ul>
        </li>
        <li className="tg-card wt-node wt-node--back">
          <span className="wt-label">Back to you</span>
          <strong>Right where you are</strong>
        </li>
      </ol>
      <h3 className="wt-sub">Works with the apps you connect</h3>
      <ul className="wt-chips wt-chips--apps" aria-label="Apps you can connect">
        {APPS.map((app) => (
          <li
            key={app}
            className={app.startsWith('Any') ? 'wt-chip-app wt-chip-app--any' : 'wt-chip-app'}
          >
            {app}
          </li>
        ))}
      </ul>
    </section>
  );
}
