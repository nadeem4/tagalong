/**
 * Walkthrough step 1: the whole idea, one companion for all your AI tools. Contains StepOne.
 * Words are the spec's step copy.
 */

export function StepOne() {
  return (
    <section>
      <h1>One companion for all your AI tools</h1>
      <p className="wt-lead">
        No more copying from one AI tool, pasting into another and carrying the answer back. Scout
        sits on your screen, sees what you’re working on when you let it, and hands real work to
        the right expert. The result comes back to where you are.
      </p>
      <div className="wt-cols">
        <ul className="wt-facts">
          <li>
            <h3>Scout stays with you</h3>
            <p>
              On your screen and in your browser. It looks at the window you’re on when you ask, and
              you can talk to it out loud.
            </p>
          </li>
          <li>
            <h3>Experts do the heavy work</h3>
            <p>
              Scout writes the brief and hands it over. Claude Code is the first expert; Gemini CLI,
              Codex and others are coming.
            </p>
          </li>
          <li>
            <h3>Your apps come along</h3>
            <p>
              Connect Notion, GitHub, Linear or any MCP server, and Scout and the experts can use
              them.
            </p>
          </li>
        </ul>
        <div aria-hidden="true">
          <span className="wt-label">Back where you are</span>
          <div className="wt-example">
            <span className="wt-chip">Claude Code · finished</span>
            <p>Fixed the empty-cart crash in billing.ts and added a test.</p>
            <span className="wt-fake-button">See the job</span>
          </div>
        </div>
      </div>
      <p className="wt-note">
        This takes about four minutes. The last step needs an Anthropic API key, so keep your
        Anthropic account handy.
      </p>
    </section>
  );
}
