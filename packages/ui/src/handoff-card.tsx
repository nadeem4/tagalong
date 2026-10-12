import { Answer } from './answer';
import { useState } from 'react';
import type { HandoffProposedParams, ProjectCandidate } from '@tagalong/protocol';
import { useHostBridge } from './host-bridge';

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
    }
  | {
      phase: 'finished';
      expertName: string;
      state: 'done' | 'error' | 'stopped';
      text?: string | undefined;
      changedFiles?: string[] | undefined;
      error?: string | undefined;
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
 * Mockup screen 4: the brief a companion wrote, shown before anything runs. The project is
 * the best guess, changed to another guess, a search result or a picked folder; edits can
 * be allowed for this one task; the brief can be edited. Send confirms, Cancel drops it.
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
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState(proposal.brief.ask);
  const [problem, setProblem] = useState<string | null>(null);
  const { expertName } = proposal;
  const project = folder === undefined ? undefined : nameOf(folder);

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
    try {
      const working = {
        phase: 'working' as const,
        handoffId: null,
        expertId: proposal.expertId,
        expertName,
        project: nameOf(folder),
        steps: [],
      };
      onSent(working);
      const { handoffId } = await bridge.confirmHandoff({
        proposalId: proposal.proposalId,
        folder,
        canEdit,
        ...(edited ? { brief: { ...proposal.brief, ask: ask.trim() } } : {}),
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
  return (
    <section className="handoff" aria-label={`Hand to ${expertName}`}>
      <p className="bubble-text">I’ll ask {expertName} to look into it. Is this right?</p>
      <dl className="handoff-rows">
        <div>
          <dt>Agent</dt>
          <dd>{expertName}</dd>
        </div>
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
        <div>
          <dt>Access</dt>
          <dd>{canEdit ? `Can change files in ${project ?? 'the project'}` : 'Reads only'}</dd>
          <button type="button" className="bubble-quiet" onClick={() => setCanEdit(!canEdit)}>
            {canEdit ? 'Reads only' : 'Allow edits'}
          </button>
        </div>
        <div>
          <dt>Brief</dt>
          <dd>
            {editing ? (
              <label className="bubble-field">
                <span>Brief</span>
                <textarea rows={4} value={ask} onChange={(event) => setAsk(event.target.value)} />
              </label>
            ) : (
              <span className="handoff-brief">{ask}</span>
            )}
          </dd>
          {!editing && (
            <button type="button" className="bubble-quiet" onClick={() => setEditing(true)}>
              Edit brief
            </button>
          )}
        </div>
      </dl>
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
    return (
      <section className="handoff" aria-label={`${handoff.expertName} is on it`}>
        <p className="bubble-text">
          <span className="handoff-dot" aria-hidden="true" /> {handoff.expertName} is on it
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
  return (
    <section className="handoff" aria-label={title}>
      <p className="bubble-hints">{title}</p>
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
.handoff-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #F2C14E; }
`;
