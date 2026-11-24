/**
 * The Runs on control on an app or expert row: where it runs (the brain's machine, this PC, both
 * with a first try, or ask each time). A tool that cannot move shows This PC, fixed. Contains RunsOn
 * and PlaceControl.
 */
import { useEffect, useRef, useState } from 'react';
import { choiceOf, placeKey, type RunsChoice, type TryFirst } from '../shapes';
import { Icon } from '../setup/icons';
import type { RunsOnModel } from './use-runs-on';

export function RunsOn({
  name,
  machine,
  choice,
  tryFirst,
  locked = false,
  onChange,
}: {
  name: string;
  /** The brain machine's name. */
  machine: string;
  choice: RunsChoice;
  tryFirst: TryFirst;
  /** A tool that only works on this PC. */
  locked?: boolean;
  onChange: (choice: RunsChoice, tryFirst: TryFirst) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const words: Record<RunsChoice, string> = {
    brain: machine,
    body: 'This PC',
    both: 'Both',
    ask: 'Ask me',
  };
  const shown = words[locked ? 'body' : choice];
  const pick = (next: RunsChoice) => {
    onChange(next, tryFirst);
    if (next !== 'both') setOpen(false);
  };
  const item = (value: RunsChoice, title: string, note: string) => (
    <button
      type="button"
      className="cx-runs__item"
      aria-pressed={choice === value}
      onClick={() => pick(value)}
    >
      <span className="cx-runs__check" aria-hidden="true">
        {choice === value && <Icon name="tick" />}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="cx-meta">{note}</span>
      </span>
    </button>
  );

  return (
    <div className="cx-runs" ref={root}>
      <button
        type="button"
        className="cx-runs__btn"
        aria-label={`Runs on, ${name}: ${shown}`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={locked}
        onClick={() => setOpen(!open)}
      >
        <span className="cx-runs__label">Runs on</span>
        {shown}
        <Icon name={locked ? 'lock' : 'chevDown'} />
      </button>
      {open && (
        <div className="cx-runs__menu" role="group" aria-label={`Where ${name} runs`}>
          {item('brain', machine, 'Where Scout’s brain lives. Always on.')}
          {item('body', 'This PC', 'Uses this computer’s files and sign-ins.')}
          {item('both', 'Both', 'Available on either. A job stays where it starts.')}
          {choice === 'both' && (
            <div className="cx-runs__first">
              <span className="cx-meta">Try first</span>
              {(['body', 'brain'] as const).map((place) => (
                <button
                  key={place}
                  type="button"
                  className="cx-runs__seg"
                  aria-pressed={tryFirst === place}
                  aria-label={`Try ${place === 'body' ? 'this PC' : machine} first`}
                  onClick={() => onChange('both', place)}
                >
                  {place === 'body' ? 'This PC' : machine}
                </button>
              ))}
            </div>
          )}
          {item('ask', 'Ask me each time', 'Scout asks in its bubble before it runs.')}
        </div>
      )}
    </div>
  );
}

/** The control for one row, or nothing on a one-machine setup. */
export function PlaceControl({
  model,
  kind,
  id,
  name,
}: {
  model: RunsOnModel | null;
  kind: 'app' | 'expert';
  id: string;
  name: string;
}) {
  if (model === null) return null;
  const { choice, tryFirst } = choiceOf(model.state.places[placeKey(kind, id)]);
  return (
    <RunsOn
      name={name}
      machine={model.machine}
      choice={choice}
      tryFirst={tryFirst}
      onChange={(next, first) => model.set(kind, id, next, first)}
    />
  );
}
