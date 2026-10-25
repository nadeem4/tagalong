/**
 * The connector confirm card: Scout wants to change something in a connected app, and
 * nothing runs until Allow once. Contains ConnectorConfirmCard. Used by the bubble.
 */

import type { ConnectorConfirmParams } from '@tagalong/protocol';

/**
 * Scout wants to change something in a connected app. Built like the hand-off card: what
 * will happen, in which app, then Allow once or Cancel. Nothing runs until Allow once.
 */
export function ConnectorConfirmCard({
  confirm,
  onAnswer,
}: {
  confirm: ConnectorConfirmParams;
  onAnswer: (decision: 'once' | 'deny') => void;
}) {
  const [what, ...filled] = confirm.summary.split('\n');
  return (
    <section className="handoff" aria-label={`Change something in ${confirm.app}?`}>
      <p className="bubble-text">Change in {confirm.app} — allow?</p>
      {confirm.risk === 'high' && <p className="handoff-brief">Can’t be undone</p>}
      <dl className="handoff-rows">
        <div>
          <dt>App</dt>
          <dd>{confirm.app}</dd>
        </div>
        <div>
          <dt>Change</dt>
          <dd>
            <span>{what}</span>
            <small>{confirm.tool}</small>
          </dd>
        </div>
        {filled.length > 0 && (
          <div>
            <dt>Details</dt>
            <dd>
              {/* Every argument in full; long ones scroll. Focusable so the keyboard can too. */}
              <span className="handoff-brief connector-details" tabIndex={0}>
                {filled.join('\n')}
              </span>
            </dd>
          </div>
        )}
      </dl>
      <div className="bubble-row">
        <button type="button" className="bubble-primary" onClick={() => onAnswer('once')}>
          Allow once
        </button>
        <button type="button" className="bubble-quiet" onClick={() => onAnswer('deny')}>
          Cancel
        </button>
      </div>
    </section>
  );
}
