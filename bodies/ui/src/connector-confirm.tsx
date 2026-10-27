/**
 * The confirm card: Scout wants to change something, and nothing runs until the person
 * clicks. Contains ConnectorConfirmCard, for a connected app's change and for a permission
 * ask from the brain's tool gate. Used by the bubble.
 */

import type { ConnectorConfirmParams } from '@tagalong/protocol';

type Decision = 'once' | 'always' | 'deny';

/**
 * Built like the hand-off card: what will happen, then Allow once, Always allow and Deny.
 * A brain ask (it carries `options`) leads with Scout's own words and drops Always allow when
 * the tool is locked; an app change keeps the connector wording and offers Allow once or Deny.
 */
export function ConnectorConfirmCard({
  confirm,
  onAnswer,
}: {
  confirm: ConnectorConfirmParams;
  onAnswer: (decision: Decision) => void;
}) {
  const [what, ...filled] = confirm.summary.split('\n');
  const isAsk = confirm.options !== undefined;
  const canAlways = confirm.options?.includes('always') ?? false;
  return (
    <section
      className="handoff"
      aria-label={isAsk ? `Allow ${confirm.tool}?` : `Change something in ${confirm.app}?`}
    >
      <p className="bubble-text">{isAsk ? what : `Change in ${confirm.app} — allow?`}</p>
      {confirm.risk === 'high' && <p className="handoff-brief">Can’t be undone</p>}
      <dl className="handoff-rows">
        <div>
          <dt>App</dt>
          <dd>{confirm.app}</dd>
        </div>
        <div>
          <dt>{isAsk ? 'Tool' : 'Change'}</dt>
          <dd>
            {isAsk ? (
              <span>{confirm.tool}</span>
            ) : (
              <>
                <span>{what}</span>
                <small>{confirm.tool}</small>
              </>
            )}
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
        {canAlways && (
          <button type="button" className="bubble-quiet" onClick={() => onAnswer('always')}>
            Always allow
          </button>
        )}
        <button type="button" className="bubble-quiet" onClick={() => onAnswer('deny')}>
          Deny
        </button>
      </div>
    </section>
  );
}
