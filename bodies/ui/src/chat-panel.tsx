/**
 * The full chat panel used by the browser extension's side panel: sight bar, messages, Stop and the composer, driven by the HostBridge turn events. Contains ChatPanel.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ContextSnapshot, PerceptionTarget, Pet } from '@tagalong/protocol';
import { Composer } from './composer';
import { MessageList, type ChatMessage } from './message-list';
import { SightBar, type SightProblem } from './sight-bar';
import { useHostBridge, type TurnEvent } from './host-bridge';
import { stopStatus } from './stop-status';

/** What Look asks the host to perceive: the picture, plus which window it came from. */
const LOOK_TARGETS = ['screenshot', 'activeWindow'] as const;

export interface ChatPanelProps {
  /** The companion: who the next ask goes to, and the name on its answers. */
  pet: Pet;
  /** What the host captured for this ask: named in the sight bar and sent with the turn. */
  snapshot?: ContextSnapshot;
  /** What Look captures in this host. Defaults to a screenshot of the active window. */
  lookTargets?: readonly PerceptionTarget[];
  /** The Look button's words, to match what `lookTargets` captures. */
  lookLabel?: string;
}

export function ChatPanel({
  pet,
  snapshot,
  lookTargets = LOOK_TARGETS,
  lookLabel,
}: ChatPanelProps) {
  const bridge = useHostBridge();
  // The host's capture is a starting point, not the last word: Look and Clear own it after.
  const [attached, setAttached] = useState<ContextSnapshot | null>(snapshot ?? null);
  const [problem, setProblem] = useState<SightProblem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  // Model calls in the last turn: tool round trips multiply them, so the footer shows the
  // count whenever a turn made more than the one call an ask costs.
  const [modelCalls, setModelCalls] = useState<number | null>(null);
  // The conversation the last answer came from, so a follow-up continues that thread.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Who answered each turn, "Scout · haiku", from its `turn.started`.
  const speakers = useRef(new Map<string, string>());
  // Background turns (Scout's own wakes and jobs): nobody asked them here, so none streams in.
  const background = useRef(new Set<string>());

  // React's documented way to reset state when a prop changes: a fresh host capture
  // replaces whatever the panel was holding, without an effect and an extra paint.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setAttached(snapshot ?? null);
    setProblem(null);
  }

  function settle(message: ChatMessage): void {
    // An interrupted turn can end with nothing said; an empty bubble says nothing either.
    if (message.text !== '') setMessages((current) => [...current, message]);
    setStreamingText('');
    setActiveTurnId(null);
  }

  function note(text: string): void {
    setMessages((current) => [
      ...current,
      { id: `note:${current.length}`, role: 'assistant', kind: 'note', text },
    ]);
  }

  function handleLook(): void {
    bridge
      .capture(lookTargets)
      .then((captured) => {
        // Null is a refusal, not an error: an excluded window has to say so out loud.
        setProblem(captured === null ? 'blocked' : null);
        if (captured !== null) {
          setAttached(captured);
        }
      })
      .catch(() => setProblem('failed'));
  }

  function handleClear(): void {
    setAttached(null);
    setProblem(null);
  }

  // An effect event, so the subscription below is made once per bridge yet always sees the
  // current pet.
  const onTurnEvent = useEffectEvent((event: TurnEvent) => {
    if (event.type === 'turn.started' && event.background === true) {
      background.current.add(event.turnId);
    }
    if (background.current.has((event as { turnId?: string }).turnId ?? '')) return;
    switch (event.type) {
      case 'turn.started': {
        const speaker = [pet.name].concat(event.model ?? []).join(' · ');
        speakers.current.set(event.turnId, speaker);
        setConversationId(event.conversationId);
        setActiveTurnId(event.turnId);
        setStreamingSpeaker(speaker);
        setStreamingText('');
        break;
      }
      case 'turn.delta':
        setStreamingText((current) => current + event.text);
        break;
      case 'turn.completed': {
        // The completed text is authoritative; deltas may have been dropped.
        const speaker = speakers.current.get(event.turnId);
        if (event.modelCalls !== undefined && event.modelCalls > 1) {
          setModelCalls(event.modelCalls);
        }
        settle({
          id: event.turnId,
          role: 'assistant',
          text: event.text,
          ...(speaker !== undefined ? { speaker } : {}),
        });
        // Nothing said, with a reason: a quiet note, not a message from Scout.
        const status = stopStatus(event.text, event.stopReason);
        if (status !== null) note(status);
        break;
      }
      case 'turn.error':
        settle({ id: `${event.turnId}:error`, role: 'assistant', text: event.message });
        break;
      default:
        // Every other notification (tool calls, warnings, connector confirms, connections) is not shown in this panel.
        break;
    }
  });

  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);

  function handleSend(text: string): void {
    setModelCalls(null);
    setMessages((current) => [...current, { id: `ask:${current.length}`, role: 'user', text }]);
    bridge
      .ask({
        petId: pet.id,
        ...(conversationId !== null ? { conversationId } : {}),
        text,
        ...(attached !== null ? { snapshot: attached } : {}),
      })
      .catch((error: unknown) => {
        // A bridge that cannot reach the engine must say so, not leave a silent panel.
        settle({
          id: `ask-error:${Date.now()}`,
          role: 'assistant',
          text: error instanceof Error ? error.message : 'The engine could not be reached.',
        });
      });
  }

  /** Stops the turn in flight. */
  function handleStop(): void {
    if (activeTurnId !== null) void bridge.interrupt(activeTurnId);
  }

  const busy = activeTurnId !== null;

  return (
    <section className="flex h-full flex-col bg-white text-slate-900">
      <SightBar
        snapshot={attached}
        problem={problem}
        onLook={handleLook}
        onClear={handleClear}
        {...(lookLabel !== undefined ? { lookLabel } : {})}
      />
      <MessageList
        messages={messages}
        streamingText={streamingText}
        {...(streamingSpeaker !== '' ? { streamingSpeaker } : {})}
      />
      {busy && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 pt-1.5">
          <button
            type="button"
            onClick={handleStop}
            className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700"
          >
            Stop
          </button>
        </div>
      )}
      <Composer onSend={handleSend} disabled={busy} seeing={attached !== null} />
      {modelCalls !== null && (
        <p
          data-testid="model-calls"
          className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-500"
        >
          {modelCalls} model calls
        </p>
      )}
    </section>
  );
}
