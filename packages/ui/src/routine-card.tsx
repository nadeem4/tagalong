/**
 * The routine card: a routine Scout wrote or changed, with its confirm button (Save, Pause,
 * Turn on or Delete), Edit (in Home) and Cancel, and one test run once a new or changed
 * routine is saved. Contains RoutineCard. Used by the bubble.
 */

import { useState } from 'react';
import {
  RoutineDraft,
  describeDeliver,
  describeWhen,
  type RoutineAction,
  type RoutineProposedParams,
} from '@tagalong/protocol';
import { useHostBridge } from './host-bridge';

const ASK: Record<RoutineAction, (name: string) => string> = {
  create: (name) => `Set up ${name}?`,
  update: (name) => `Change ${name}?`,
  pause: (name) => `Pause ${name}?`,
  resume: (name) => `Turn ${name} back on?`,
  delete: (name) => `Delete ${name}?`,
};

const LEAD: Record<RoutineAction, string> = {
  create: 'Nothing runs until you save it.',
  update: 'Nothing changes until you save it.',
  pause: 'It stays paused until you turn it back on.',
  resume: 'It runs again on its schedule.',
  delete: 'This can’t be undone.',
};

const CONFIRM: Record<RoutineAction, string> = {
  create: 'Save',
  update: 'Save',
  pause: 'Pause',
  resume: 'Turn on',
  delete: 'Delete',
};

/**
 * Scout wrote or changed a routine: the card says what would be saved, built like the
 * hand-off card. Save is the person's consent; Edit opens it in Home's form; Cancel drops it.
 * After a new or changed routine is saved, the card offers one test run.
 */
export function RoutineCard({
  proposal,
  onDone,
}: {
  proposal: RoutineProposedParams;
  onDone: () => void;
}) {
  const bridge = useHostBridge();
  const routine = RoutineDraft.parse(proposal.routine);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { action } = proposal;

  const save = async (): Promise<void> => {
    try {
      const result = await bridge.confirmRoutine?.(proposal.proposalId);
      if ((action === 'create' || action === 'update') && result?.routine !== undefined) {
        setSaved(result.routine.id);
      } else onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  if (saved !== null) {
    return (
      <section className="handoff" aria-label={`${routine.name} is saved`}>
        <p className="bubble-text" role="status">
          Saved. Run it now to test?
        </p>
        <div className="bubble-row">
          <button
            type="button"
            className="bubble-primary"
            onClick={() => {
              void bridge.runRoutine?.(saved);
              onDone();
            }}
          >
            Run it now
          </button>
          <button type="button" className="bubble-quiet" onClick={onDone}>
            Not now
          </button>
        </div>
      </section>
    );
  }

  const uses = [
    ...routine.uses.filter((use) => use !== proposal.handToName),
    ...(proposal.handToName !== undefined
      ? [`May hand to: ${proposal.handToName}, read-only, no project`]
      : []),
  ];

  return (
    <section className="handoff routine-card" aria-label={ASK[action](routine.name)}>
      <p className="bubble-text">{LEAD[action]}</p>
      <dl className="handoff-rows">
        <div>
          <dt>Name</dt>
          <dd>{routine.name}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{describeWhen(routine.when)}</dd>
        </div>
        <div>
          <dt>What</dt>
          <dd>
            <span className="handoff-brief connector-details">{routine.what}</span>
            {routine.topics.trim() !== '' && <small>Topics: {routine.topics.trim()}</small>}
          </dd>
        </div>
        {uses.length > 0 && (
          <div>
            <dt>Uses</dt>
            <dd>
              {uses.map((use) => (
                <span key={use}>{use}</span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>Result goes to</dt>
          <dd>{describeDeliver(routine.deliver)}</dd>
        </div>
      </dl>
      {error !== null && (
        <p role="alert" className="bubble-error">
          {error}
        </p>
      )}
      <div className="bubble-row">
        <button type="button" className="bubble-primary" onClick={() => void save()}>
          {CONFIRM[action]}
        </button>
        {(action === 'create' || action === 'update') && bridge.editRoutine !== undefined && (
          <button
            type="button"
            className="bubble-quiet"
            onClick={() => {
              void bridge.editRoutine?.(proposal);
              onDone();
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="bubble-quiet"
          onClick={() => {
            void bridge.dismissRoutine?.(proposal.proposalId);
            onDone();
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
