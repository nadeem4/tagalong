/**
 * The confirm card: Scout wants to change something, and nothing runs until the person
 * clicks. Contains ConnectorConfirmCard, for a connected app's change, a permission ask from
 * the brain's tool gate, and the asks a Claude Code job opens (hand-off, relayed permission,
 * question). Used by the bubble.
 */

import { useState } from 'react';
import type { ConnectorConfirmParams } from './shapes';

type Decision = 'once' | 'always' | 'deny';
export type JobAnswer = { option: string; text?: string; apps?: string[] };

const GATE_OPTIONS = new Set(['allow', 'always', 'deny']);

/**
 * Built like the hand-off card: what will happen, then Not now, Always allow and Allow.
 * A tool that cannot be always allowed carries the "Always asks" chip.
 * A brain ask (it carries `options`) leads with Scout's own words and drops Always allow when
 * the tool is locked; an app change keeps the connector wording and offers Allow once or Deny.
 * A job's ask has options of its own (modes, Claude Code's permission names) or is a question,
 * so it shows each option as a button and, for a question, a text field; it answers by name.
 */
export function ConnectorConfirmCard({
  confirm,
  onAnswer,
  onReply,
}: {
  confirm: ConnectorConfirmParams;
  onAnswer: (decision: Decision) => void;
  onReply: (answer: JobAnswer) => void;
}) {
  const [typed, setTyped] = useState('');
  // A hand-off's apps still on the card; choosing a mode (Send) approves exactly these.
  const [kept, setKept] = useState(confirm.apps ?? []);
  const isAsk = confirm.options !== undefined;
  const isJob =
    confirm.question === true ||
    confirm.freeText === true ||
    (isAsk && !confirm.options!.every((o) => GATE_OPTIONS.has(o)));
  // An app change is a line plus its details; a brain ask is Scout's words, shown whole.
  const [first, ...rest] = confirm.summary.split('\n');
  const what = isAsk ? confirm.summary : (first ?? '');
  const filled = isAsk ? [] : rest;
  const canAlways = confirm.options?.includes('always') ?? false;

  if (isJob) {
    const text = typed.trim();
    const typable = confirm.question === true || confirm.freeText === true;
    // The brain takes typed text with any option name. An expert's question sends the text as
    // the option; Scout's choice sends no option, since none was picked.
    const sendTyped = (): void => {
      onReply({ option: confirm.question === true ? text : '', text });
    };
    // The options keep the order Scout gave; the recommended one is the gold, marked row.
    const options = confirm.options ?? [];
    const gold =
      confirm.recommended !== undefined && options.includes(confirm.recommended)
        ? confirm.recommended
        : options[0];
    // Only a card that came with apps answers with a list, so other asks stay as they were.
    const withApps = confirm.apps !== undefined ? { apps: kept.map((a) => a.id) } : {};
    return (
      <section className="card" aria-label={`${confirm.app} asks`}>
        <p className="bubble-text" style={{ whiteSpace: 'pre-line' }}>
          {confirm.summary}
        </p>
        {typable && (
          <label className="bubble-field">
            Your answer
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text !== '') sendTyped();
              }}
            />
          </label>
        )}
        {confirm.apps !== undefined && (
          <div className="card-brief" role="group" aria-label="Apps this job may use">
            <span>Apps this job may use{kept.length === 0 ? ': none' : ''}</span>
            {kept.map((app) => (
              <span key={app.id} className="bubble-tag">
                {app.name}{' '}
                <button
                  type="button"
                  className="bubble-quiet"
                  aria-label={`Remove ${app.name}`}
                  onClick={() => setKept(kept.filter((a) => a.id !== app.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="bubble-choices" role="group" aria-label="Options">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`bubble-choice ${option === gold ? 'bubble-primary' : 'bubble-quiet'}`}
              onClick={() => onReply({ option, ...withApps })}
            >
              <span className="bubble-radio" aria-hidden="true" />
              <span className="bubble-choice-text">{option}</span>
              {option === confirm.recommended && (
                <>
                  {' '}
                  <span className="bubble-tag">Recommended</span>
                </>
              )}
            </button>
          ))}
        </div>
        {typable && (
          <div className="bubble-row">
            <button
              type="button"
              className="bubble-primary"
              disabled={text === ''}
              onClick={sendTyped}
            >
              Send
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="card"
      aria-label={isAsk ? `Allow ${confirm.tool}?` : `Change something in ${confirm.app}?`}
    >
      <div className="card-head">
        <p className="bubble-text" style={isAsk ? { whiteSpace: 'pre-line' } : undefined}>
          {isAsk ? what : `Change in ${confirm.app} — allow?`}
        </p>
        {!canAlways && <span className="card-chip">Always asks</span>}
      </div>
      {confirm.risk === 'high' && <p className="card-brief">Can’t be undone</p>}
      <dl className="card-rows">
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
              <span className="card-brief connector-details" tabIndex={0}>
                {filled.join('\n')}
              </span>
            </dd>
          </div>
        )}
      </dl>
      <div className="card-actions" role="group" aria-label="Options">
        <button type="button" className="bubble-quiet" onClick={() => onAnswer('deny')}>
          Not now
        </button>
        {canAlways && (
          <button type="button" className="bubble-quiet" onClick={() => onAnswer('always')}>
            Always allow
          </button>
        )}
        <button type="button" className="bubble-primary" onClick={() => onAnswer('once')}>
          Allow
        </button>
      </div>
    </section>
  );
}
