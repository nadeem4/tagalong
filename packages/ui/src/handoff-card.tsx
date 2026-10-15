import { Answer } from './answer';
import { useState } from 'react';
import type { HandoffProposedParams, ProjectCandidate } from '@tagalong/protocol';
import { useHostBridge } from './host-bridge';

/** What one finished step of a two-step hand-off sent back, kept while step 2 works. */
export interface StepResult {
  expertName: string;
  text?: string | undefined;
  changedFiles?: string[] | undefined;
}

/** A hand-off as the bubble shows it: proposed, running, or come back. */
export type Handoff =
  | { phase: 'proposed'; proposal: HandoffProposedParams }
  | {
      phase: 'working';
      /** Null until the host answers the confirm; steps may arrive before it. */
      handoffId: string | null;
      expertId: string;
      expertName: string;
      project: string;
      steps: string[];
      /** A two-step hand-off: who comes next, or what step 1 already sent back. */
      chain?: { step: 1; nextName: string } | { step: 2; earlier: StepResult } | undefined;
    }
  | {
      phase: 'finished';
      expertName: string;
      state: 'done' | 'error' | 'stopped';
      text?: string | undefined;
      changedFiles?: string[] | undefined;
      error?: string | undefined;
      /** Step 1's answer, when this was step 2 of a chain. */
      earlier?: StepResult | undefined;
      /** Step 2's expert, when step 1 failed or was stopped so step 2 never ran. */
      skipped?: string | undefined;
    };

function nameOf(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .filter((part) => part !== '')
      .pop() ?? path
  );
}

/**
 * One step's Access and Brief rows: edits allowed for this task, and the brief to edit.
 * `carriesWindowEnd` notes that the brief takes the end of the error window along.
 */
function StepRows({
  canEdit,
  onToggle,
  ask,
  onAsk,
  project,
  carriesWindowEnd = false,
}: {
  canEdit: boolean;
  onToggle: () => void;
  ask: string;
  onAsk: (ask: string) => void;
  project: string | undefined;
  carriesWindowEnd?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div>
        <dt>Access</dt>
        <dd>{canEdit ? `Can change files in ${project ?? 'the project'}` : 'Reads only'}</dd>
        <button type="button" className="bubble-quiet" onClick={onToggle}>
          {canEdit ? 'Reads only' : 'Allow edits'}
        </button>
      </div>
      <div>
        <dt>Brief</dt>
        <dd>
          {editing ? (
            <label className="bubble-field">
              <span>Brief</span>
              <textarea rows={4} value={ask} onChange={(event) => onAsk(event.target.value)} />
            </label>
          ) : (
            <span className="handoff-brief">{ask}</span>
          )}
          {carriesWindowEnd && <small>Includes the end of the error window</small>}
        </dd>
        {!editing && (
          <button type="button" className="bubble-quiet" onClick={() => setEditing(true)}>
            Edit brief
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Mockup screen 4: the brief a companion wrote, shown before anything runs. The project is
 * the best guess, changed to another guess, a search result or a picked folder; edits can
 * be allowed for this one task; the brief can be edited. Send confirms, Cancel drops it.
 * With a follow-up step, both steps share the one project and the one Send; each has its own
 * access and brief, and step 2 can be removed.
 */
export function ProposalCard({
  proposal,
  onSent,
  onCancelled,
}: {
  proposal: HandoffProposedParams;
  onSent: (handoff: Extract<Handoff, { phase: 'working' }>) => void;
  onCancelled: () => void;
}) {
  const bridge = useHostBridge();
  const [folder, setFolder] = useState<string | undefined>(proposal.projects[0]?.path);
  const [picking, setPicking] = useState(proposal.projects.length === 0);
  const [results, setResults] = useState<ProjectCandidate[]>([]);
  const [canEdit, setCanEdit] = useState(proposal.canEdit);
  const [ask, setAsk] = useState(proposal.brief.ask);
  const [chained, setChained] = useState(proposal.then !== undefined);
  const [nextCanEdit, setNextCanEdit] = useState(proposal.then?.canEdit ?? false);
  const [nextAsk, setNextAsk] = useState(proposal.then?.ask ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const { expertName } = proposal;
  const project = folder === undefined ? undefined : nameOf(folder);
  const then = chained ? proposal.then : undefined;

  const choose = (path: string): void => {
    setFolder(path);
    setPicking(false);
  };

  const search = (query: string): void => {
    void bridge.searchProjects?.(query).then(setResults);
  };

  const browse = (): void => {
    void bridge.pickFolder?.().then((path) => path !== null && choose(path));
  };

  const send = async (): Promise<void> => {
    if (folder === undefined || bridge.confirmHandoff === undefined) return;
    const edited = ask.trim() !== '' && ask.trim() !== proposal.brief.ask;
    const nextEdited = then !== undefined && nextAsk.trim() !== '' && nextAsk.trim() !== then.ask;
    try {
      const working = {
        phase: 'working' as const,
        handoffId: null,
        expertId: proposal.expertId,
        expertName,
        project: nameOf(folder),
        steps: [],
        ...(then === undefined ? {} : { chain: { step: 1 as const, nextName: then.expertName } }),
      };
      onSent(working);
      const { handoffId } = await bridge.confirmHandoff({
        proposalId: proposal.proposalId,
        folder,
        canEdit,
        ...(edited ? { brief: { ...proposal.brief, ask: ask.trim() } } : {}),
        ...(proposal.then === undefined
          ? {}
          : {
              then:
                then === undefined
                  ? null
                  : { canEdit: nextCanEdit, ...(nextEdited ? { ask: nextAsk.trim() } : {}) },
            }),
      });
      onSent({ ...working, handoffId });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = (): void => {
    void bridge.dismissHandoff?.(proposal.proposalId);
    onCancelled();
  };

  const others = proposal.projects.filter((p) => p.path !== folder);
  const firstRows = (
    <StepRows
      canEdit={canEdit}
      onToggle={() => setCanEdit(!canEdit)}
      ask={ask}
      onAsk={setAsk}
      project={project}
      carriesWindowEnd={proposal.brief.context?.windowText !== undefined}
    />
  );
  return (
    <section
      className="handoff"
      aria-label={
        then === undefined
          ? `Hand to ${expertName}`
          : `Hand to ${expertName}, then ${then.expertName}`
      }
    >
      <p className="bubble-text">
        {then === undefined
          ? `I’ll ask ${expertName} to look into it. Is this right?`
          : `I’ll ask ${expertName} first, then ${then.expertName}. Is this right?`}
      </p>
      <dl className="handoff-rows">
        {then === undefined && (
          <div>
            <dt>Agent</dt>
            <dd>{expertName}</dd>
          </div>
        )}
        <div>
          <dt>Project</dt>
          <dd>
            {folder === undefined ? (
              <span>Choose the project to work in</span>
            ) : (
              <>
                <strong>{project}</strong>
                <small>{folder}</small>
              </>
            )}
          </dd>
          {!picking && (
            <button type="button" className="bubble-quiet" onClick={() => setPicking(true)}>
              Change project
            </button>
          )}
        </div>
        {picking && (
          <div className="handoff-picker">
            {[...others, ...results.filter((r) => !others.some((o) => o.path === r.path))].map(
              (candidate) => (
                <button
                  key={candidate.path}
                  type="button"
                  className="handoff-option"
                  onClick={() => choose(candidate.path)}
                >
                  <strong>{candidate.name}</strong> <small>{candidate.path}</small>
                </button>
              ),
            )}
            <label className="bubble-field">
              <span>Search projects</span>
              <input autoFocus onChange={(event) => search(event.target.value)} />
            </label>
            {bridge.pickFolder !== undefined && (
              <button type="button" className="bubble-quiet" onClick={browse}>
                Browse…
              </button>
            )}
          </div>
        )}
        {then === undefined && firstRows}
      </dl>
      {then !== undefined && (
        <>
          <div role="group" aria-label={`Step 1: ${expertName}`} className="handoff-step">
            <p className="handoff-step-title">1. {expertName}</p>
            <dl className="handoff-rows">{firstRows}</dl>
          </div>
          <div role="group" aria-label={`Step 2: ${then.expertName}`} className="handoff-step">
            <p className="handoff-step-title">
              2. {then.expertName}
              <button type="button" className="bubble-quiet" onClick={() => setChained(false)}>
                Remove step 2
              </button>
            </p>
            <dl className="handoff-rows">
              <StepRows
                canEdit={nextCanEdit}
                onToggle={() => setNextCanEdit(!nextCanEdit)}
                ask={nextAsk}
                onAsk={setNextAsk}
                project={project}
              />
            </dl>
          </div>
        </>
      )}
      {problem !== null && (
        <p role="alert" className="bubble-error">
          {problem}
        </p>
      )}
      <div className="bubble-row">
        <button
          type="button"
          className="bubble-primary"
          disabled={folder === undefined}
          onClick={() => void send()}
        >
          Send
        </button>
        <button type="button" className="bubble-quiet" onClick={cancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/** Mockup screens 5 and 6: the expert at work, then what it sent back. */
export function HandoffStatus({
  handoff,
  onStop,
  onDismiss,
}: {
  handoff: Exclude<Handoff, { phase: 'proposed' }>;
  onStop: () => void;
  onDismiss: () => void;
}) {
  if (handoff.phase === 'working') {
    const label =
      handoff.chain === undefined
        ? `${handoff.expertName} is on it`
        : handoff.chain.step === 1
          ? `${handoff.expertName} is on it (1 of 2)`
          : `${handoff.expertName} is checking (2 of 2)`;
    return (
      <section className="handoff" aria-label={label}>
        <p className="bubble-text">
          <span className="handoff-dot" aria-hidden="true" /> {label}
        </p>
        <ul className="handoff-steps" aria-live="polite">
          {handoff.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ul>
        <div className="bubble-row bubble-hints">
          <span>{handoff.project} · keep working, I’ll tell you</span>
          <button type="button" className="bubble-quiet" onClick={onStop}>
            Stop
          </button>
        </div>
      </section>
    );
  }
  const ok = handoff.state === 'done';
  const title =
    handoff.state === 'stopped'
      ? `${handoff.expertName} was stopped`
      : ok
        ? `${handoff.expertName} finished`
        : `${handoff.expertName} could not finish`;
  const { earlier } = handoff;
  return (
    <section className="handoff" aria-label={title}>
      {earlier !== undefined && (
        <>
          <p className="bubble-hints">
            {earlier.changedFiles !== undefined && earlier.changedFiles.length > 0
              ? `${earlier.expertName} changed ${earlier.changedFiles.join(', ')}`
              : `${earlier.expertName} finished`}
          </p>
          {earlier.text !== undefined && (
            <div className="bubble-answer">
              <Answer text={earlier.text} />
            </div>
          )}
        </>
      )}
      <p className="bubble-hints">
        {earlier !== undefined && ok ? `${handoff.expertName} says` : title}
      </p>
      {handoff.text !== undefined && (
        <div className="bubble-answer">
          <Answer text={handoff.text} />
        </div>
      )}
      {handoff.error !== undefined && (
        <p role="alert" className="bubble-error">
          {handoff.error}
        </p>
      )}
      {handoff.changedFiles !== undefined && handoff.changedFiles.length > 0 && (
        <p className="bubble-hints">Changed {handoff.changedFiles.join(', ')}</p>
      )}
      {handoff.skipped !== undefined && (
        <p className="bubble-hints">{handoff.skipped} did not start.</p>
      )}
      <div className="bubble-row">
        <button type="button" className="bubble-quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

export const HANDOFF_CSS = `
.handoff { display: flex; flex-direction: column; gap: 10px; }
.handoff-rows { display: flex; flex-direction: column; gap: 0; margin: 0; border-top: 1px solid #262C4A; }
.handoff-rows > div {
  display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #262C4A;
}
.handoff-rows dt { width: 56px; flex: none; font-size: 12px; color: #A3AAC4; }
.handoff-rows dd { flex: 1; min-width: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.handoff-rows dd small, .handoff-option small { font-size: 11px; color: #A3AAC4; overflow-wrap: anywhere; }
.handoff-rows > div > .bubble-quiet { align-self: center; flex: none; }
.handoff-brief { font-size: 12px; line-height: 1.5; color: #C9CEE0; }
.handoff-picker { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid #262C4A; }
.handoff-option {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 10px;
  border: 1px solid #2E3558; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.handoff-steps {
  margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; color: #A3AAC4;
}
.handoff-steps li:last-child { color: #E9ECF5; }
.connector-details { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.routine-card .handoff-rows dt { width: 72px; }
.handoff-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #F2C14E; }
.handoff-step { display: flex; flex-direction: column; gap: 4px; }
.handoff-step-title {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0;
  font-size: 12px; font-weight: 600; color: #E9ECF5;
}
`;
