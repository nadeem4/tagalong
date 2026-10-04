import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ContextSnapshot, PerceptionTarget, Pet } from '@tagalong/protocol';
import { Composer } from './composer';
import { CrewStrip, DEFAULT_PET_COLOR } from './crew-strip';
import { MessageList, type ChatMessage } from './message-list';
import { SightBar, type SightProblem } from './sight-bar';
import { useHostBridge, type TurnEvent } from './host-bridge';

/** What Look asks the host to perceive: the picture, plus which window it came from. */
const LOOK_TARGETS = ['screenshot', 'activeWindow'] as const;

export interface ChatPanelProps {
  /** The pet the next ask goes to. The panel may move on — a handoff — and says so. */
  petId: string;
  /** The crew. Omitted, the panel asks the bridge for it. */
  pets?: readonly Pet[];
  /** Told whenever the active pet changes: a click in the strip, or a handoff. */
  onPetChange?: (petId: string) => void;
  /** What the host captured for this ask: named in the sight bar and sent with the turn. */
  snapshot?: ContextSnapshot;
  /** What Look captures in this host. Defaults to a screenshot of the active window. */
  lookTargets?: readonly PerceptionTarget[];
  /** The Look button's words, to match what `lookTargets` captures. */
  lookLabel?: string;
}

/** Who is answering a turn, from its `turn.started`. */
interface TurnInfo {
  petId: string;
  speaker: string;
}

export function ChatPanel({
  petId,
  pets: givenPets,
  onPetChange,
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
  const [fetchedPets, setFetchedPets] = useState<readonly Pet[]>([]);
  const [activePetId, setActivePetId] = useState(petId);
  const [draft, setDraft] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  // Model calls in the current crew run: consults and roundtables multiply them, so the
  // footer shows the count whenever a run made more than the one call an ask costs.
  const [modelCalls, setModelCalls] = useState<number | null>(null);
  // The roundtable in progress, from crew.status; null when none is.
  const [crewRun, setCrewRun] = useState<string | null>(null);
  const [speakingPetId, setSpeakingPetId] = useState<string | null>(null);
  // Which conversation each pet is in, so a follow-up continues the thread it answered in.
  const [conversations, setConversations] = useState<Record<string, string>>({});
  const turns = useRef(new Map<string, TurnInfo>());
  const pets = givenPets ?? fetchedPets;

  // React's documented way to reset state when a prop changes: a fresh host capture
  // replaces whatever the panel was holding, without an effect and an extra paint.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setAttached(snapshot ?? null);
    setProblem(null);
  }
  const [lastPetId, setLastPetId] = useState(petId);
  if (petId !== lastPetId) {
    setLastPetId(petId);
    setActivePetId(petId);
  }

  useEffect(() => {
    if (givenPets !== undefined) return;
    let live = true;
    bridge
      .listPets()
      .then((list) => {
        if (live) setFetchedPets(list);
      })
      // A crew that cannot be listed leaves a single-pet panel, which still works.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge, givenPets]);

  function selectPet(id: string): void {
    setActivePetId(id);
    onPetChange?.(id);
  }

  function settle(message: ChatMessage): void {
    // An interrupted turn can end with nothing said; an empty bubble says nothing either.
    if (message.text !== '') setMessages((current) => [...current, message]);
    setStreamingText('');
    setActiveTurnId(null);
    setSpeakingPetId(null);
  }

  function note(text: string): void {
    setMessages((current) => [
      ...current,
      { id: `round:${current.length}`, role: 'assistant', kind: 'round', text },
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
  // current crew and the host's latest callback.
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
        setSpeakingPetId(event.petId);
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
        // During a roundtable crew.status owns the count, summed across every turn.
        if (crewRun === null && event.modelCalls !== undefined && event.modelCalls > 1) {
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
      case 'crew.status':
        setModelCalls(event.modelCalls);
        if (event.state === 'running') {
          setCrewRun(event.runId);
        } else {
          setCrewRun(null);
          if (event.state === 'stopped') note('Roundtable stopped');
        }
        break;
      case 'pet.message':
        if (event.kind === 'roundtable') note(event.text);
        if (event.kind === 'handoff') {
          setMessages((current) => [
            ...current,
            {
              id: `handoff:${event.turnId ?? current.length}`,
              role: 'assistant',
              kind: 'handoff',
              text: event.text,
              fromPetId: event.fromPetId,
              toPetId: event.toPetId,
            },
          ]);
          selectPet(event.toPetId);
        }
        if (event.kind === 'consult') {
          setMessages((current) => [
            ...current,
            {
              id: `consult:${current.length}`,
              role: 'assistant',
              kind: 'consult',
              text: event.text,
              fromPetId: event.fromPetId,
              toPetId: event.toPetId,
            },
          ]);
        }
        break;
      default:
        // Audio and tool events belong to later phases.
        break;
    }
  });

  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);

  function handleSend(text: string): void {
    setDraft('');
    setModelCalls(null);
    setMessages((current) => [...current, { id: `ask:${current.length}`, role: 'user', text }]);
    const conversationId = conversations[activePetId];
    bridge
      .ask({
        petId: activePetId,
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

  function handleHandoff(_fromPetId: string, toPetId: string): void {
    const target = pets.find((pet) => pet.id === toPetId);
    if (target !== undefined) setDraft(`@${target.name} `);
  }

  /** Puts the composer text to the whole crew, or starts a `/crew ` line to type into. */
  function handleCrew(): void {
    const question = draft.trim().replace(/^\/crew\b\s*/i, '');
    if (question === '') {
      setDraft('/crew ');
      return;
    }
    handleSend(`/crew ${question}`);
  }

  /** Interrupting the turn in flight also ends a roundtable: the engine cancels the rest. */
  function handleStop(): void {
    if (activeTurnId !== null) void bridge.interrupt(activeTurnId);
  }

  // A roundtable is busy between its turns too, so the composer waits for the whole run.
  const busy = activeTurnId !== null || crewRun !== null;
  const activePet = pets.find((pet) => pet.id === activePetId);

  return (
    <section className="flex h-full flex-col bg-white text-slate-900">
      {pets.length > 1 && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
          <span
            data-testid="active-pet"
            data-color={activePet?.color ?? DEFAULT_PET_COLOR}
            className="text-sm font-semibold"
            style={{ color: activePet?.color ?? DEFAULT_PET_COLOR }}
          >
            {activePet === undefined ? activePetId : `${activePet.avatar} ${activePet.name}`}
          </span>
          <CrewStrip
            pets={pets}
            activePetId={activePetId}
            onSelect={selectPet}
            speakingPetIds={speakingPetId === null ? [] : [speakingPetId]}
          />
        </header>
      )}
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
        pets={pets}
        {...(streamingSpeaker !== '' ? { streamingSpeaker } : {})}
        {...(pets.length > 1 ? { onHandoff: handleHandoff } : {})}
      />
      {(pets.length > 1 || busy) && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 pt-1.5">
          {busy && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700"
            >
              Stop
            </button>
          )}
          {pets.length > 1 && (
            <button
              type="button"
              aria-label="Ask the crew"
              title="Put the question to every pet, then hear a synthesis"
              onClick={handleCrew}
              disabled={busy}
              className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-white disabled:bg-slate-300"
            >
              Crew
            </button>
          )}
        </div>
      )}
      <Composer
        onSend={handleSend}
        disabled={busy}
        seeing={attached !== null}
        value={draft}
        onValueChange={setDraft}
      />
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
