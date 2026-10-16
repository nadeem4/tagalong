/**
 * The full chat panel used by the browser extension's side panel: sight bar, watch chips,
 * messages, Stop and the composer, driven by the HostBridge turn events. Contains ChatPanel.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ContextSnapshot, PerceptionTarget, Pet } from '@tagalong/protocol';
import { Composer } from './composer';
import { MessageList, type ChatMessage } from './message-list';
import { SightBar, type SightProblem } from './sight-bar';
import { useHostBridge, type TurnEvent } from './host-bridge';

/** What Look asks the host to perceive: the picture, plus which window it came from. */
const LOOK_TARGETS = ['screenshot', 'activeWindow'] as const;

export interface ChatPanelProps {
  /** The pet the next ask goes to. */
  petId: string;
  /** The pets, for the speaker's name and the watcher's. */
  pets: readonly Pet[];
  /** What the host captured for this ask: named in the sight bar and sent with the turn. */
  snapshot?: ContextSnapshot;
  /** What Look captures in this host. Defaults to a screenshot of the active window. */
  lookTargets?: readonly PerceptionTarget[];
  /** The Look button's words, to match what `lookTargets` captures. */
  lookLabel?: string;
}

/** A watch in progress, from its latest `watch.status`. */
interface RunningWatch {
  watchId: string;
  petId: string;
  condition: string;
  checks: number;
  maxChecks: number;
  checkModel?: string;
}

/** Who is answering a turn, from its `turn.started`. */
interface TurnInfo {
  petId: string;
  speaker: string;
}

export function ChatPanel({
  petId,
  pets,
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
  // Which conversation each pet is in, so a follow-up continues the thread it answered in.
  const [conversations, setConversations] = useState<Record<string, string>>({});
  // Watches running now, shown as chips with a Stop button each.
  const [watches, setWatches] = useState<readonly RunningWatch[]>([]);
  const turns = useRef(new Map<string, TurnInfo>());

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
  // current pets and the host's latest callback.
  const onTurnEvent = useEffectEvent((event: TurnEvent) => {
    switch (event.type) {
      case 'turn.started': {
        const name = pets.find((pet) => pet.id === event.petId)?.name;
        const speaker = [name ?? (pets.length > 0 ? event.petId : undefined)]
          .concat(event.model)
          .filter((part): part is string => part !== undefined)
          .join(' · ');
        turns.current.set(event.turnId, { petId: event.petId, speaker });
        setConversations((current) => ({ ...current, [event.petId]: event.conversationId }));
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
        const info = turns.current.get(event.turnId);
        if (event.modelCalls !== undefined && event.modelCalls > 1) {
          setModelCalls(event.modelCalls);
        }
        settle({
          id: event.turnId,
          role: 'assistant',
          text: event.text,
          ...(info !== undefined ? { petId: info.petId } : {}),
          ...(info !== undefined && info.speaker !== '' ? { speaker: info.speaker } : {}),
        });
        break;
      }
      case 'turn.error':
        settle({ id: `${event.turnId}:error`, role: 'assistant', text: event.message });
        break;
      case 'watch.status':
        if (event.state === 'watching') {
          const running: RunningWatch = {
            watchId: event.watchId,
            petId: event.petId,
            condition: event.condition,
            checks: event.checks,
            maxChecks: event.maxChecks,
            ...(event.checkModel === undefined ? {} : { checkModel: event.checkModel }),
          };
          setWatches((current) => [
            ...current.filter((watch) => watch.watchId !== event.watchId),
            running,
          ]);
        } else {
          setWatches((current) => current.filter((watch) => watch.watchId !== event.watchId));
          // Fired says so with its own card, and Stop was the user's own doing; the other
          // endings happened while nobody was looking, so the reason is put in the log.
          if (event.state !== 'fired' && event.state !== 'stopped') {
            note(event.detail ?? `Stopped watching for “${event.condition}”.`);
          }
        }
        break;
      case 'watch.fired': {
        const condition = watches.find((watch) => watch.watchId === event.watchId)?.condition;
        setMessages((current) => [
          ...current,
          {
            id: `watch:${event.watchId}`,
            role: 'assistant',
            kind: 'watch',
            text: event.message,
            petId: event.petId,
            ...(condition === undefined ? {} : { condition }),
          },
        ]);
        break;
      }
      default:
        // Every other notification (tool calls, warnings, hand-offs, connector confirms,
        // routines, connections, moods, settings) is not shown in this panel.
        break;
    }
  });

  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);

  function handleSend(text: string): void {
    setModelCalls(null);
    setMessages((current) => [...current, { id: `ask:${current.length}`, role: 'user', text }]);
    const conversationId = conversations[petId];
    bridge
      .ask({
        petId,
        ...(conversationId !== undefined ? { conversationId } : {}),
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
      {watches.map((watch) => {
        const watcher = pets.find((pet) => pet.id === watch.petId);
        return (
          <div
            key={watch.watchId}
            data-testid="watching"
            className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-900"
          >
            <span aria-hidden="true">⏱</span>
            <span className="font-semibold">Watching</span>
            <span className="truncate">
              {watcher === undefined ? '' : `${watcher.name}: `}“{watch.condition}”
            </span>
            <span
              className="ml-auto shrink-0 text-sky-700"
              title="Model checks spent, and the small model answering them"
            >
              {watch.checks}/{watch.maxChecks} checks
              {watch.checkModel === undefined ? '' : ` · ${watch.checkModel}`}
            </span>
            {bridge.stopWatch !== undefined && (
              <button
                type="button"
                onClick={() => void bridge.stopWatch?.(watch.watchId)}
                className="shrink-0 rounded-md border border-sky-300 bg-white px-2 py-0.5 font-medium"
              >
                Stop
              </button>
            )}
          </div>
        );
      })}
      <MessageList
        messages={messages}
        streamingText={streamingText}
        pets={pets}
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
