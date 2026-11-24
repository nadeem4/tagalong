/**
 * The confirm card: Scout wants to change something, and nothing runs until the person
 * clicks. Contains ConnectorConfirmCard, for a connected app's change, a permission ask from
 * the brain's tool gate, and the asks a Claude Code job opens (hand-off, relayed permission,
 * question), and the Ask me card for where an app should run. Used by the bubble.
 */

import { useState } from 'react';
import { useHostBridge } from './host-bridge';
import { useBrainCard } from './home/use-brain-card';
import { placeOf, type ConnectorConfirmParams } from './shapes';

/** The brain's own option in a where-to-run ask; the other option is the body's name. */
const BRAIN_OPTION = 'Brain';

type Decision = 'once' | 'always' | 'deny';
export type JobAnswer = { option: string; text?: string; checkBackAt?: string };

/** `gmail__send_message` reads "send message": the app is on its own row, and underscores are not words. */
const toolLabel = (tool: string): string =>
  tool.includes(':') ? tool : tool.replace(/^.*?__/, '').replace(/_/g, ' ');

/** A fact's row label: `to` reads "To", a message `body` reads "Says". */
const factLabel = (key: string): string =>
  key === 'body' ? 'Says' : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

const GATE_OPTIONS = new Set(['allow', 'always', 'deny', 'not_now', 'stop_task']);

/** The two task options carry the brain's names; the person reads plain words. */
const optionLabel = (option: string): string =>
  option === 'not_now' ? 'Not now' : option === 'stop_task' ? 'Stop the task' : option;

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The next time the clock reads `hhmm`: today if still ahead, else tomorrow. */
function nextAt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date();
  at.setHours(h ?? 0, m ?? 0, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

/**
 * A task card's head: the task's title, then when Scout checks back, with a way to move it.
 * Choosing a time answers Not now with that time; the brain keeps the card until then.
 */
function TaskNote({
  confirm,
  onReply,
}: {
  confirm: ConnectorConfirmParams;
  onReply: (answer: JobAnswer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const at = confirm.checkBackAt === undefined ? null : new Date(confirm.checkBackAt);
  const [time, setTime] = useState(at === null ? '' : clock(at));
  return (
    <>
      {confirm.task?.title !== undefined && <p className="card-task">{confirm.task.title}</p>}
      {at !== null && !Number.isNaN(at.getTime()) && (
        <div className="card-checkback">
          <span className="card-brief">Checking back at {clock(at)}</span>
          {confirm.checkBackBy === 'person' && <span className="card-chip">Set by you</span>}
          {!editing && (
            <button type="button" className="bubble-quiet" onClick={() => setEditing(true)}>
              Change time
            </button>
          )}
          {editing && (
            <>
              <input
                type="time"
                aria-label="Check back at"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              <button
                type="button"
                className="bubble-quiet"
                disabled={time === ''}
                onClick={() => onReply({ option: 'not_now', checkBackAt: nextAt(time) })}
              >
                Set time
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The brain asks where an app runs, once, because the row says Ask me each time. The brain's
 * options are `Brain` and the body's name; the buttons read This PC and the brain machine's name,
 * and answer with the brain's own words. "Remember my choice" also sets the row, so it stops asking.
 */
function WhereCard({
  place,
  confirm,
  onReply,
}: {
  place: { app: string; body: string; name: string };
  confirm: ConnectorConfirmParams;
  onReply: (answer: JobAnswer) => void;
}) {
  const bridge = useHostBridge();
  const { card } = useBrainCard();
  const [keep, setKeep] = useState(false);
  const bodyOption = (confirm.options ?? []).find((o) => o !== BRAIN_OPTION) ?? '';
  const choose = (option: string): void => {
    if (!keep) return onReply({ option });
    const choice = option === bodyOption ? 'body' : 'brain';
    bridge.setPlacement('app', place.app, placeOf(choice, 'body', place.body)).then(
      () => onReply({ option }),
      () => onReply({ option }),
    );
  };
  const heading = `Where should ${place.name} run?`;
  return (
    <section className="card" aria-label={heading}>
      <div className="card-head">
        <p className="bubble-text">{heading}</p>
      </div>
      <label className="bubble-check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        Remember my choice for {place.name}
      </label>
      <div className="card-actions" role="group" aria-label="Options">
        <button type="button" className="bubble-quiet" onClick={() => choose(bodyOption)}>
          This PC
        </button>
        <button type="button" className="bubble-primary" onClick={() => choose(BRAIN_OPTION)}>
          {card?.host ?? 'The brain'}
        </button>
      </div>
    </section>
  );
}

/**
 * Built like the hand-off card: what will happen, then Not now, Always allow and Allow.
 * A tool that cannot be always allowed carries the "Always asks" chip.
 * A brain ask (it carries `options`) leads with Scout's own words and drops Always allow when
 * the tool is locked; an app change keeps the connector wording and offers Allow or Not now.
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
  // A task's card also lets the person put it off or end the task; the brain moves the check-back.
  const ofTask = confirm.options?.includes('not_now') ?? false;

  if (confirm.place !== undefined)
    return <WhereCard place={confirm.place} confirm={confirm} onReply={onReply} />;

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
    return (
      <section className="card" aria-label={`${confirm.app} asks`}>
        <TaskNote confirm={confirm} onReply={onReply} />
        <div className="card-head">
          <p className="bubble-text" style={{ whiteSpace: 'pre-line' }}>
            {confirm.summary}
          </p>
        </div>
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
        <div className="bubble-choices" role="group" aria-label="Options">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`bubble-choice ${option === gold ? 'bubble-primary' : 'bubble-quiet'}`}
              onClick={() => onReply({ option })}
            >
              <span className="bubble-radio" aria-hidden="true" />
              <span className="bubble-choice-text">{optionLabel(option)}</span>
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
      <TaskNote confirm={confirm} onReply={onReply} />
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
              <span>{toolLabel(confirm.tool)}</span>
            ) : (
              <>
                <span>{what}</span>
                <small>{confirm.tool}</small>
              </>
            )}
          </dd>
        </div>
        {isAsk &&
          Object.entries(confirm.facts ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{factLabel(key)}</dt>
              <dd>
                <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
              </dd>
            </div>
          ))}
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
        {ofTask && (
          <button
            type="button"
            className="bubble-quiet"
            onClick={() => onReply({ option: 'stop_task' })}
          >
            Stop the task
          </button>
        )}
        {ofTask && (
          <button
            type="button"
            className="bubble-quiet"
            onClick={() => onReply({ option: 'not_now' })}
          >
            Not now
          </button>
        )}
        <button type="button" className="bubble-quiet" onClick={() => onAnswer('deny')}>
          {ofTask ? 'No' : 'Not now'}
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
