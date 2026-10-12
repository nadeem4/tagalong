import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ContextSnapshot } from '@tagalong/protocol';
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
}: CompanionBubbleProps) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState('');
  const [removed, setRemoved] = useState<ReadonlySet<Chip['id']>>(new Set());
  const [reply, setReply] = useState<Reply>({ state: 'idle' });
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
      default:
        return;
    }
  });
  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);

  if (greeting) {
    return (
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
    );
  }

  const send = (): void => {
    const text = draft.trim();
    if (text === '' || reply.state === 'running') return;
    setDraft('');
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
  return (
    <div className="bubble">
      <style>{BUBBLE_CSS}</style>
      {chips.length > 0 && (
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
      )}

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

      <label className="bubble-field">
        <span>Ask {petName}</span>
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
  );
}

const BUBBLE_CSS = `
.bubble {
  box-sizing: border-box; display: flex; flex-direction: column; gap: ${t.space.lg}px;
  padding: 14px 16px; background: ${t.color.page}; color: ${t.color.text};
  border: 1px solid ${t.color.fieldLine}; border-radius: 12px; font-family: ${t.font.ui};
}
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
