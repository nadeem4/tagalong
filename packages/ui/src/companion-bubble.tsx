import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContextSnapshot } from '@tagalong/protocol';
import { HANDOFF_CSS, HandoffStatus, ProposalCard, type Handoff } from './handoff-card';
import { useHostBridge } from './host-bridge';
import type { TurnEvent } from './host-bridge';
import { officeTokens as t } from './office/tokens';

export interface CompanionBubbleProps {
  petId: string;
  petName: string;
  /** What the hotkey captured. Each part shows as a chip the person can remove. */
  snapshot?: ContextSnapshot;
  /** The one-time hello after Welcome, instead of the question box. */
  greeting?: boolean;
  /** The ask key as a person reads it, for the hello. */
  hotkeyLabel?: string;
  onDismiss?: () => void;
  onOpenChat?: () => void;
  /** The full chat: the whole conversation, not just the latest answer. */
  expanded?: boolean;
  /** Back from the full chat to the bubble. */
  onCollapse?: () => void;
  /** Hides the bubble; Escape does the same. */
  onClose?: () => void;
  /** Which side of the bubble the pet is on: the speech tail points there. */
  tail?: 'left' | 'right';
}

/** A question and how it was answered, once it is over. */
interface Exchange {
  question: string;
  answer: string;
  failed: boolean;
}

/** One removable part of what the companion can see. */
interface Chip {
  id: 'app' | 'selection' | 'screenshot';
  label: string;
}

function chipsOf(snapshot: ContextSnapshot | undefined): Chip[] {
  if (snapshot === undefined) return [];
  const chips: Chip[] = [];
  if (snapshot.app !== undefined) {
    const title = snapshot.app.windowTitle;
    chips.push({ id: 'app', label: title ? `${snapshot.app.name} · ${title}` : snapshot.app.name });
  }
  if (snapshot.selection !== undefined) chips.push({ id: 'selection', label: 'Selected text' });
  if (snapshot.screenshot !== undefined || snapshot.composite !== undefined) {
    chips.push({ id: 'screenshot', label: 'Screenshot' });
  }
  return chips;
}

/** The snapshot without the parts the person took out. */
function without(snapshot: ContextSnapshot, removed: ReadonlySet<Chip['id']>): ContextSnapshot {
  const { app, selection, screenshot, composite, displays, ...rest } = snapshot;
  return {
    ...rest,
    ...(app !== undefined && !removed.has('app') ? { app } : {}),
    ...(selection !== undefined && !removed.has('selection') ? { selection } : {}),
    ...(removed.has('screenshot')
      ? {}
      : {
          ...(screenshot !== undefined ? { screenshot } : {}),
          ...(composite !== undefined ? { composite } : {}),
          ...(displays !== undefined ? { displays } : {}),
        }),
  };
}

type Reply =
  | { state: 'idle' }
  | { state: 'running'; turnId: string | null; text: string }
  | { state: 'done'; text: string }
  | { state: 'failed'; text: string };

/**
 * The companion's bubble beside the pet: the quick way to ask about what is on screen.
 * It shows what the pet can see as chips (each one removable), takes one question,
 * streams the answer into itself, and keeps the conversation for the next question. The
 * full chat is one click away for anything longer.
 */
export function CompanionBubble({
  petId,
  petName,
  snapshot,
  greeting = false,
  hotkeyLabel = 'Ctrl+Shift+Space',
  onDismiss,
  onOpenChat,
  expanded = false,
  onCollapse,
  onClose,
  tail,
}: CompanionBubbleProps) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState('');
  const [removed, setRemoved] = useState<ReadonlySet<Chip['id']>>(new Set());
  const [reply, setReply] = useState<Reply>({ state: 'idle' });
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [past, setPast] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const conversation = useRef<string | undefined>(undefined);
  const mine = useRef<string | null>(null);

  // A new capture brings every chip back: removing is per question, not forever.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setRemoved(new Set());
  }

  const onTurnEvent = useEffectEvent((event: TurnEvent) => {
    switch (event.type) {
      case 'turn.started':
        if (event.petId !== petId || reply.state !== 'running') return;
        mine.current = event.turnId;
        conversation.current = event.conversationId;
        setReply({ state: 'running', turnId: event.turnId, text: '' });
        return;
      case 'turn.delta':
        if (event.turnId !== mine.current) return;
        setReply((current) =>
          current.state === 'running' ? { ...current, text: current.text + event.text } : current,
        );
        return;
      case 'turn.completed':
        if (event.turnId !== mine.current) return;
        mine.current = null;
        setReply({ state: 'done', text: event.text });
        return;
      case 'turn.error':
        if (event.turnId !== mine.current) return;
        mine.current = null;
        setReply({ state: 'failed', text: event.message });
        return;
      case 'handoff.proposed':
        if (event.petId === petId) setHandoff({ phase: 'proposed', proposal: event });
        return;
      case 'handoff.progress':
        setHandoff((current) =>
          current?.phase === 'working' &&
          current.expertId === event.expertId &&
          (current.handoffId === null || current.handoffId === event.handoffId)
            ? { ...current, steps: [...current.steps, event.step] }
            : current,
        );
        return;
      case 'handoff.finished':
        setHandoff((current) =>
          current?.phase === 'working' &&
          current.expertId === event.expertId &&
          (current.handoffId === null || current.handoffId === event.handoffId)
            ? {
                phase: 'finished',
                expertName: current.expertName,
                state: event.state,
                text: event.text,
                changedFiles: event.changedFiles,
                error: event.error,
              }
            : current,
        );
        return;
      default:
        return;
    }
  });
  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);

  if (greeting) {
    return (
      <Speech tail={tail}>
        <div className="bubble">
          <style>{BUBBLE_CSS}</style>
          <p role="status" className="bubble-text">
            I’m here. Press {hotkeyLabel} whenever you want me, or click me.
          </p>
          <div className="bubble-row">
            <button type="button" className="bubble-primary" onClick={onDismiss}>
              Got it
            </button>
          </div>
        </div>
      </Speech>
    );
  }

  const send = (): void => {
    const text = draft.trim();
    if (text === '' || reply.state === 'running') return;
    setDraft('');
    if (question !== null && (reply.state === 'done' || reply.state === 'failed')) {
      const answered = { question, answer: reply.text, failed: reply.state === 'failed' };
      setPast((current) => [...current, answered]);
    }
    setQuestion(text);
    setReply({ state: 'running', turnId: null, text: '' });
    const context = snapshot === undefined ? undefined : without(snapshot, removed);
    bridge
      .ask({
        petId,
        ...(conversation.current !== undefined ? { conversationId: conversation.current } : {}),
        text,
        ...(context !== undefined ? { snapshot: context } : {}),
      })
      .then(({ turnId }) => {
        mine.current ??= turnId;
      })
      .catch((error: unknown) =>
        setReply({
          state: 'failed',
          text: error instanceof Error ? error.message : 'Tagalong could not reach its engine.',
        }),
      );
  };

  const stop = (): void => {
    if (mine.current !== null) void bridge.interrupt(mine.current);
  };

  const chips = chipsOf(snapshot).filter((chip) => !removed.has(chip.id));
  const chipList = chips.length > 0 && (
    <ul className="bubble-chips" aria-label={`What ${petName} can see`}>
      {chips.map((chip) => (
        <li key={chip.id} className="bubble-chip">
          <span>{chip.label}</span>
          <button
            type="button"
            aria-label={`Do not send ${chip.label}`}
            onClick={() => setRemoved(new Set([...removed, chip.id]))}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
  const answer = (
    <>
      {reply.state === 'running' && (
        <div className="bubble-answer" aria-live="polite">
          <p className="bubble-text">
            {reply.text === '' ? `${petName} is thinking…` : reply.text}
          </p>
          <button type="button" className="bubble-quiet" onClick={stop}>
            Stop
          </button>
        </div>
      )}
      {reply.state === 'done' && <p className="bubble-text bubble-answer">{reply.text}</p>}
      {reply.state === 'failed' && (
        <p role="alert" className="bubble-error">
          {reply.text}
        </p>
      )}
    </>
  );
  const handoffCard = (
    <>
      {handoff?.phase === 'proposed' && (
        <ProposalCard
          key={handoff.proposal.proposalId}
          proposal={handoff.proposal}
          onSent={setHandoff}
          onCancelled={() => setHandoff(null)}
        />
      )}
      {handoff !== null && handoff.phase !== 'proposed' && (
        <HandoffStatus
          handoff={handoff}
          onStop={() => {
            if (handoff.phase === 'working' && handoff.handoffId !== null) {
              void bridge.cancelHandoff?.(handoff.handoffId);
            }
          }}
          onDismiss={() => setHandoff(null)}
        />
      )}
    </>
  );
  const field = (label: string) => (
    <label className="bubble-field">
      <span>{label}</span>
      <input
        value={draft}
        autoFocus
        disabled={reply.state === 'running'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') send();
        }}
      />
    </label>
  );

  const closeButton = onClose !== undefined && (
    <button type="button" className="bubble-close" aria-label="Close" onClick={onClose}>
      ×
    </button>
  );

  if (expanded) {
    return (
      <Speech tail={tail}>
        <div className="bubble bubble--chat">
          <style>{BUBBLE_CSS}</style>
          <style>{HANDOFF_CSS}</style>
          <header className="bubble-head">
            <strong>{petName}</strong>
            <span className="bubble-row">
              {onCollapse !== undefined && (
                <button type="button" className="bubble-quiet" onClick={onCollapse}>
                  Back to bubble
                </button>
              )}
              {closeButton}
            </span>
          </header>
          <div className="bubble-log" role="log" aria-label={`Conversation with ${petName}`}>
            {past.length === 0 && question === null && (
              <p className="bubble-hints">Ask {petName} anything about what is on your screen.</p>
            )}
            {past.map((exchange, index) => (
              <div key={index} className="bubble-exchange">
                <p className="bubble-mine">{exchange.question}</p>
                <p className={exchange.failed ? 'bubble-error' : 'bubble-text'}>
                  {exchange.answer}
                </p>
              </div>
            ))}
            {question !== null && (
              <div className="bubble-exchange">
                <p className="bubble-mine">{question}</p>
                {answer}
              </div>
            )}
            {handoffCard}
          </div>
          <footer className="bubble-foot">
            {chipList}
            {field(`Message ${petName}`)}
          </footer>
        </div>
      </Speech>
    );
  }

  return (
    <Speech tail={tail}>
      <div className="bubble">
        <style>{BUBBLE_CSS}</style>
        <style>{HANDOFF_CSS}</style>
        <div className="bubble-top">
          {chipList || <span />}
          {closeButton}
        </div>
        {answer}
        {handoffCard}
        {field(`Ask ${petName}`)}
        <div className="bubble-row bubble-hints">
          <span>Enter to ask</span>
          <span>Esc to close</span>
          {onOpenChat !== undefined && (
            <button type="button" className="bubble-quiet" onClick={onOpenChat}>
              Open full chat
            </button>
          )}
        </div>
      </div>
    </Speech>
  );
}

/** The bubble with a speech tail on the side the pet is on, so it reads as the pet talking. */
function Speech({ tail, children }: { tail: 'left' | 'right' | undefined; children: ReactNode }) {
  return (
    <div className="speech" data-tail={tail ?? 'none'}>
      <style>{SPEECH_CSS}</style>
      {children}
      {tail !== undefined && <span className="speech-tail" aria-hidden="true" />}
    </div>
  );
}

const SPEECH_CSS = `
.speech { position: relative; box-sizing: border-box; }
.speech[data-tail='left'] { padding-left: 10px; }
.speech[data-tail='right'] { padding-right: 10px; }
.speech-tail {
  position: absolute; bottom: 34px; width: 14px; height: 14px; background: ${t.color.page};
  border: 1px solid ${t.color.fieldLine}; transform: rotate(45deg);
}
.speech[data-tail='left'] .speech-tail { left: 4px; border-top: 0; border-right: 0; }
.speech[data-tail='right'] .speech-tail { right: 4px; border-bottom: 0; border-left: 0; }
`;

const BUBBLE_CSS = `
.bubble {
  box-sizing: border-box; display: flex; flex-direction: column; gap: ${t.space.lg}px;
  padding: 14px 16px; background: ${t.color.page}; color: ${t.color.text};
  border: 1px solid ${t.color.fieldLine}; border-radius: 12px; font-family: ${t.font.ui};
}
.bubble--chat { height: 100vh; padding: 0; gap: 0; overflow: hidden; }
.bubble-head {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px 10px 16px; border-bottom: 1px solid #262C4A; background: ${t.color.sidebar};
}
.bubble-head strong { font-family: ${t.font.pixel}; font-size: 16px; letter-spacing: 0.5px; }
.bubble-head .bubble-quiet { align-self: center; }
.bubble-log { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 16px; }
.bubble-exchange { display: flex; flex-direction: column; gap: 8px; }
.bubble-mine {
  align-self: flex-end; max-width: 80%; margin: 0; padding: 8px 12px; border-radius: 12px 12px 4px 12px;
  background: #222845; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
}
.bubble-foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-top: 1px solid #262C4A; }
.bubble-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.bubble-close {
  flex: none; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent;
  color: ${t.color.textMuted}; font-size: 18px; line-height: 1; cursor: pointer;
}
.bubble-close:hover { background: #222845; color: ${t.color.text}; }
.bubble-text { margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
.bubble-answer { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.bubble-error { margin: 0; padding: 8px 12px; border-radius: 6px; background: #3a1d2a; color: #ffb4c0; font-size: 13px; }
.bubble-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.bubble-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 28px;
  padding: 0 4px 0 10px; border-radius: 999px; background: #222845; color: #C9CEE0; font-size: 12px;
}
.bubble-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bubble-chip button {
  width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent;
  color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: ${t.color.textMuted}; }
.bubble-field input {
  height: 44px; box-sizing: border-box; padding: 0 12px; border: 1px solid #7CB8F2;
  border-radius: 8px; background: ${t.color.field}; color: ${t.color.text}; font: inherit; font-size: 14px;
}
.bubble-row { display: flex; align-items: center; gap: 12px; }
.bubble-hints { font-size: 11px; color: ${t.color.textMuted}; }
.bubble-hints .bubble-quiet { margin-left: auto; }
.bubble-primary {
  height: 36px; padding: 0 16px; border: 0; border-radius: 8px; background: ${t.color.gold};
  color: ${t.color.goldInk}; font: inherit; font-weight: 600; cursor: pointer;
}
.bubble-quiet {
  align-self: flex-start; min-height: 28px; padding: 0 10px; border: 1px solid ${t.color.fieldLine};
  border-radius: 6px; background: transparent; color: #C9CEE0; font: inherit; font-size: 12px; cursor: pointer;
}
`;
