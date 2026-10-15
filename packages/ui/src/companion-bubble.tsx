import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pushable } from '@tagalong/protocol';
import type {
  ConnectorConfirmParams,
  ContextSnapshot,
  Mouth,
  PickUpReadyParams,
  RoutineProposedParams,
} from '@tagalong/protocol';
import { ANSWER_CSS, Answer } from './answer';
import { HANDOFF_CSS, HandoffStatus, ProposalCard, type Handoff } from './handoff-card';
import { ConnectorConfirmCard } from './connector-confirm';
import { RoutineCard } from './routine-card';
import { PickUpCard } from './pick-up-card';
import { DropCard, type DropOffer } from './drop-card';
import { useHostBridge } from './host-bridge';
import { wantsHealthCheck } from './health-ask';
import { healthHeadline, healthRows } from './health';
import type { FixTarget, HealthRow } from './health';
import { HealthCard } from './health-card';
import type { TurnEvent } from './host-bridge';
import { officeTokens as t } from './office/tokens';
import { SpokenStream } from './voice/spoken-stream';
import { wantsReadAloud } from './voice/read-aloud';

/**
 * Talk to Scout, as the bubble sees it: the host holds the microphone and turns speech into
 * text; the bubble shows that it is listening and asks what was heard, as a spoken question.
 */
export interface BubbleTalk {
  /** Listening to the microphone, or turning what it heard into text. */
  state: 'idle' | 'listening' | 'hearing';
  /** Subscribes to each spoken question as it is heard; returns an unsubscribe function. */
  onHeard: (handler: (text: string) => void) => () => void;
  /** Subscribes to each start of listening, for barge-in; returns an unsubscribe function. */
  onListen?: (handler: () => void) => () => void;
  /** A line about the microphone: nothing heard, the model downloading, a failure. */
  note: string | null;
  /** The words heard so far, shown while listening. */
  partial?: string | null;
  /** The talk key as a person reads it, for "Hold … to reply". */
  keyLabel: string;
  /** The mic button: click to talk, click again to send. */
  onMic: () => void;
  /** Always listening: a saved setting, off by default. Paused during a call or full screen. */
  always?: { on: boolean; paused: boolean; onToggle: () => void };
}

export interface CompanionBubbleProps {
  petId: string;
  petName: string;
  /** What the hotkey captured. Each part shows as a chip the person can remove. */
  snapshot?: ContextSnapshot;
  /** The one-line invitation after setup, instead of the question box. */
  greeting?: boolean;
  /** The ask key as a person reads it, for the hello. */
  hotkeyLabel?: string;
  /** What the person asked to be called, for the hello. Empty: no name. */
  userName?: string;
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
  /**
   * A line the bubble says, for the host to speak aloud: each finished answer, the hello,
   * and an expert's finish. Called once per line, with the text as shown.
   */
  onSay?: (text: string) => void;
  /** Speaks the answer to a spoken question, sentence by sentence as it streams. */
  mouth?: Mouth;
  /** Whether the host is speaking now: the bubble shows it, with a way to stop. */
  speaking?: boolean;
  onStopSpeaking?: () => void;
  /**
   * Opens on a routine's result: its name stands for the question, its answer is shown, and
   * the next question continues its conversation.
   */
  resume?: { conversationId: string; question: string; answer: string };
  /** Talk to Scout: the mic button, the listening state and what was heard. */
  talk?: BubbleTalk;
  /** Whether Scout may look at the screen: the Seeing switch in the header. */
  seeing?: { on: boolean; onToggle: () => void };
  /** Pick up where you left off: the card Pick up on the line opened. */
  pickUp?: PickUpReadyParams;
  /** The pick-up card is done: Not now, or Brief again handed it to the hand-off card. */
  onPickUpDone?: () => void;
  /** Something dropped on Scout: the drop card, until one of its buttons is pressed. */
  drop?: DropOffer;
  /** The drop card was answered or cancelled. */
  onDropDone?: () => void;
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

/** What Try it now asks, from the hello: a first look at the screen. */
const TRY_IT = 'What am I working on, and what could you hand to an expert?';

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
  userName = '',
  onDismiss,
  onOpenChat,
  expanded = false,
  onCollapse,
  onClose,
  tail,
  onSay,
  mouth,
  speaking = false,
  onStopSpeaking,
  resume,
  talk,
  seeing,
  pickUp,
  onPickUpDone,
  drop,
  onDropDone,
}: CompanionBubbleProps) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState('');
  const [removed, setRemoved] = useState<ReadonlySet<Chip['id']>>(new Set());
  const [reply, setReply] = useState<Reply>(
    resume === undefined ? { state: 'idle' } : { state: 'done', text: resume.answer },
  );
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  // A change Scout wants to make in a connected app, waiting for Allow once or Cancel.
  const [confirm, setConfirm] = useState<ConnectorConfirmParams | null>(null);
  // A routine Scout wrote or changed, waiting for Save.
  const [routine, setRoutine] = useState<RoutineProposedParams | null>(null);
  const [past, setPast] = useState<Exchange[]>([]);
  // A draft's Copy, when this host can write the clipboard.
  const copyText = useMemo(
    () => (bridge.copyText === undefined ? undefined : (text: string) => bridge.copyText!(text)),
    [bridge],
  );
  const [question, setQuestion] = useState<string | null>(resume?.question ?? null);
  // Try it now ends the hello here, even when the screen could not be seen.
  const [tried, setTried] = useState(false);
  const conversation = useRef<string | undefined>(resume?.conversationId);
  const mine = useRef<string | null>(null);
  // A spoken question's answer, said sentence by sentence as it streams.
  const spoken = useRef<{ stream: SpokenStream; lines: Pushable<string> } | null>(null);
  // The last answer was to a spoken question: the bubble offers the key to reply.
  const [spokenReply, setSpokenReply] = useState(false);
  // The question was spoken: the bubble shows what it heard, so a mishearing is visible.
  const [askedAloud, setAskedAloud] = useState(false);
  // "Scout, what's wrong?": the health card, its rows null while the facts are read.
  const [health, setHealth] = useState<{ rows: HealthRow[] | null } | null>(null);
  // Each question bumps it, so a check that finishes late never covers a newer answer.
  const healthRun = useRef(0);

  // A new drop opens its card again; a button or Cancel closes it.
  const [openDrop, setOpenDrop] = useState(drop);
  const [lastDrop, setLastDrop] = useState(drop);
  if (drop !== lastDrop) {
    setLastDrop(drop);
    setOpenDrop(drop);
  }

  // A new capture brings every chip back: removing is per question, not forever.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setRemoved(new Set());
  }

  const onTurnEvent = useEffectEvent((event: TurnEvent) => {
    if (
      (event.type === 'turn.completed' || event.type === 'turn.error') &&
      event.turnId === confirm?.turnId
    ) {
      setConfirm(null);
    }
    switch (event.type) {
      case 'connector.confirm': {
        if (event.petId !== petId) return;
        const { type: _type, ...params } = event;
        setConfirm(params);
        return;
      }
      case 'routine.proposed': {
        if (event.petId !== petId) return;
        const { type: _type, ...params } = event;
        setRoutine(params);
        return;
      }
      case 'turn.started':
        // A routine's turn runs on its own; its result arrives as routine.result.
        if (event.petId !== petId || reply.state !== 'running' || event.routineId !== undefined) {
          return;
        }
        mine.current = event.turnId;
        conversation.current = event.conversationId;
        setReply({ state: 'running', turnId: event.turnId, text: '' });
        return;
      case 'turn.delta':
        if (event.turnId !== mine.current) return;
        spoken.current?.stream.push(event.text);
        setReply((current) =>
          current.state === 'running' ? { ...current, text: current.text + event.text } : current,
        );
        return;
      case 'turn.completed':
        if (event.turnId !== mine.current) return;
        mine.current = null;
        setReply({ state: 'done', text: event.text });
        if (spoken.current === null) {
          onSay?.(event.text);
        } else {
          spoken.current.stream.end();
          spoken.current.lines.end();
          spoken.current = null;
          setSpokenReply(true);
        }
        return;
      case 'turn.error':
        if (event.turnId !== mine.current) return;
        mine.current = null;
        spoken.current?.lines.end();
        spoken.current = null;
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
        if (
          handoff?.phase === 'working' &&
          handoff.expertId === event.expertId &&
          (handoff.handoffId === null || handoff.handoffId === event.handoffId)
        ) {
          onSay?.(
            event.state === 'done'
              ? `${handoff.expertName} has finished. ${event.text ?? ''}`.trim()
              : `${handoff.expertName} stopped without finishing.`,
          );
        }
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

  const speakingIndicator = speaking && onStopSpeaking !== undefined && (
    <button
      type="button"
      className="bubble-speaking"
      aria-label="Stop speaking"
      title="Stop speaking"
      onClick={onStopSpeaking}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
  );

  const listening = talk !== undefined && talk.state === 'listening';
  const micButton = talk !== undefined && (
    <button
      type="button"
      className="bubble-mic"
      aria-label={listening ? 'Stop listening' : `Talk to ${petName}`}
      aria-pressed={listening}
      title={listening ? 'Stop listening' : `Talk to ${petName} (or hold ${talk.keyLabel})`}
      onClick={talk.onMic}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
        <path d="M3 8a5 5 0 0 0 10 0M8 13v2" stroke="currentColor" fill="none" strokeWidth="1.5" />
      </svg>
    </button>
  );
  const alwaysToggle = talk?.always !== undefined && (
    <button
      type="button"
      role="switch"
      className="bubble-toggle"
      aria-checked={talk.always.on}
      onClick={talk.always.onToggle}
      title={
        talk.always.on
          ? 'Scout is listening all the time. Click to stop.'
          : 'Let Scout listen all the time'
      }
    >
      Always listening
    </button>
  );
  const seeingToggle = seeing !== undefined && (
    <button
      type="button"
      role="switch"
      className="bubble-toggle"
      aria-checked={seeing.on}
      onClick={seeing.onToggle}
      title={
        seeing.on
          ? 'Scout can see your screen. Click to pause.'
          : 'Sight is paused. Click to let Scout see.'
      }
    >
      Seeing
    </button>
  );
  const talkLine =
    talk === undefined
      ? null
      : talk.always?.on === true && talk.state === 'idle'
        ? talk.always.paused
          ? 'Listening paused during a call or full screen.'
          : 'Listening. Start with “Scout” to ask.'
        : talk.state === 'listening'
          ? 'Listening… let go of the key, or click the mic, to send.'
          : talk.state === 'hearing'
            ? 'Turning that into text…'
            : null;
  const talkStatus = talk !== undefined && (talkLine !== null || talk.note !== null) && (
    <p role="status" className="bubble-listening" data-state={talk.state}>
      {talk.state !== 'idle' && <span className="bubble-listening-dot" aria-hidden="true" />}
      {[talkLine, talk.note].filter((part) => part !== null).join(' ')}
      {talk.partial ? (
        <span className="bubble-partial" aria-live="off">
          {talk.partial}
        </span>
      ) : null}
    </p>
  );
  const replyHint = talk !== undefined && spokenReply && reply.state === 'done' && (
    <span>Hold {talk.keyLabel} to reply</span>
  );

  /**
   * Asks one question, with what the companion can see, and keeps the last answer above.
   * A spoken question may cut in on an answer still running: the engine stops that turn.
   */
  const submit = (
    text: string,
    context: ContextSnapshot | undefined,
    asSpoken = false,
    withDrop = false,
  ): void => {
    if (question !== null && (reply.state === 'done' || reply.state === 'failed')) {
      const answered = { question, answer: reply.text, failed: reply.state === 'failed' };
      setPast((current) => [...current, answered]);
    }
    healthRun.current += 1;
    setHealth(null);
    if (bridge.checkHealth !== undefined && wantsHealthCheck(text)) {
      checkHealth(text, asSpoken);
      return;
    }
    setQuestion(text);
    setReply({ state: 'running', turnId: null, text: '' });
    setSpokenReply(false);
    setAskedAloud(asSpoken);
    mine.current = null;
    spoken.current?.lines.end();
    if (asSpoken && mouth !== undefined) {
      const lines = new Pushable<string>();
      mouth.speak(lines);
      spoken.current = { stream: new SpokenStream((line) => lines.push(line)), lines };
    } else spoken.current = null;
    bridge
      .ask({
        petId,
        ...(conversation.current !== undefined ? { conversationId: conversation.current } : {}),
        text,
        ...(context !== undefined ? { snapshot: context } : {}),
        ...(asSpoken ? { spoken: true } : {}),
        // Only a button on the drop card sends the dropped item, never a spoken ask.
        ...(withDrop ? { drop: true } : {}),
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

  /**
   * "Scout, what's wrong?": the health card instead of a turn, read from the host with no
   * model call, so it works when Scout cannot think. An answer still running is stopped.
   * Only the headline is said; the card's rows are for reading.
   */
  const checkHealth = (text: string, asSpoken: boolean): void => {
    if (mine.current !== null) void bridge.interrupt(mine.current);
    mine.current = null;
    spoken.current?.lines.end();
    spoken.current = null;
    setQuestion(text);
    setAskedAloud(asSpoken);
    setSpokenReply(false);
    setReply({ state: 'idle' });
    setHealth({ rows: null });
    const run = healthRun.current;
    const read = bridge.checkHealth?.() ?? Promise.reject(new Error('no health check'));
    read
      .then((facts) => {
        if (run !== healthRun.current) return;
        const rows = healthRows(facts);
        const headline = healthHeadline(rows);
        setHealth({ rows });
        // Kept as the answer, so the full chat's history shows what the check said.
        setReply({ state: 'done', text: headline });
        onSay?.(headline);
      })
      .catch(() => {
        if (run !== healthRun.current) return;
        setHealth(null);
        setReply({ state: 'failed', text: 'I couldn’t run the health check.' });
      });
  };

  const send = (): void => {
    const text = draft.trim();
    if (text === '' || reply.state === 'running') return;
    setDraft('');
    // "Read this to me", or a reply to "Shall I go on?" after a reading, is spoken whole.
    const continuing = spokenReply && reply.state === 'done' && /go on\?\s*$/i.test(reply.text);
    submit(
      text,
      snapshot === undefined ? undefined : without(snapshot, removed),
      wantsReadAloud(text) || continuing,
    );
  };

  // A spoken question arrives from the host: ask it, once per new `seq`.
  const askHeard = useEffectEvent((text: string) => {
    if (text.trim() === '') return;
    submit(text, snapshot === undefined ? undefined : without(snapshot, removed), true);
  });
  const onHeard = talk?.onHeard;
  useEffect(() => onHeard?.((text) => askHeard(text)), [onHeard]);

  // Barge-in: talking over Scout stops the answer still streaming, not only its voice,
  // and nothing more of it is said.
  const bargeIn = useEffectEvent(() => {
    if (reply.state !== 'running') return;
    spoken.current?.lines.end();
    spoken.current = null;
    if (mine.current !== null) void bridge.interrupt(mine.current);
    // The bubble keeps what was said so far and ignores the rest of the stopped turn.
    mine.current = null;
    setReply({ state: 'done', text: reply.text });
  });
  const onListen = talk?.onListen;
  useEffect(() => onListen?.(() => bargeIn()), [onListen]);

  const tryIt = async (): Promise<void> => {
    setTried(true);
    const seen = await bridge.capture(['activeWindow', 'screenshot']).catch(() => null);
    submit(TRY_IT, seen ?? undefined);
  };

  if (greeting && !tried) {
    return (
      <Speech tail={tail}>
        <TryItInvite
          hotkeyLabel={hotkeyLabel}
          userName={userName}
          onTry={() => void tryIt()}
          {...(onDismiss !== undefined ? { onDismiss } : {})}
          {...(onSay !== undefined ? { onSay } : {})}
          indicator={speakingIndicator}
        />
      </Speech>
    );
  }

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
  const turnAnswer = (
    <>
      {reply.state === 'running' && (
        <div className="bubble-answer" aria-live="polite">
          {reply.text === '' ? (
            <p className="bubble-text">{petName} is thinking…</p>
          ) : (
            <Answer text={reply.text} />
          )}
          <button type="button" className="bubble-quiet" onClick={stop}>
            Stop
          </button>
        </div>
      )}
      {reply.state === 'done' && (
        <div className="bubble-answer">
          <Answer text={reply.text} onCopy={copyText} />
        </div>
      )}
      {reply.state === 'failed' && (
        <p role="alert" className="bubble-error">
          {reply.text}
        </p>
      )}
    </>
  );
  // A health check answers with its card, in the answer's place.
  const answer =
    health === null ? (
      turnAnswer
    ) : (
      <HealthCard
        rows={health.rows}
        {...(bridge.openFix !== undefined
          ? { onFix: (target: FixTarget) => void bridge.openFix?.(target) }
          : {})}
      />
    );
  const answerConfirm = (decision: 'once' | 'deny'): void => {
    if (confirm === null) return;
    void bridge.approveTool?.(confirm.approvalId, decision);
    setConfirm(null);
  };
  const closeDrop = (): void => {
    setOpenDrop(undefined);
    onDropDone?.();
  };
  const handoffCard = (
    <>
      {pickUp !== undefined && <PickUpCard pickUp={pickUp} onDone={() => onPickUpDone?.()} />}
      {openDrop !== undefined && (
        <DropCard
          offer={openDrop}
          onCancel={closeDrop}
          onAsk={(text) => {
            closeDrop();
            submit(
              text,
              snapshot === undefined ? undefined : without(snapshot, removed),
              false,
              true,
            );
          }}
        />
      )}
      {confirm !== null && (
        <ConnectorConfirmCard key={confirm.approvalId} confirm={confirm} onAnswer={answerConfirm} />
      )}
      {routine !== null && (
        <RoutineCard key={routine.proposalId} proposal={routine} onDone={() => setRoutine(null)} />
      )}
      {handoff?.phase === 'proposed' && (
        <ProposalCard
          key={handoff.proposal.proposalId}
          proposal={handoff.proposal}
          // A quick expert can finish before Send hears back its id: keep what it sent.
          onSent={(next) =>
            setHandoff((current) => (current?.phase === 'finished' ? current : next))
          }
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
      {/* Named outright: the mic button inside the label would join its name in Chromium. */}
      <input
        aria-label={label}
        value={draft}
        autoFocus
        disabled={reply.state === 'running'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') send();
        }}
      />
      {micButton}
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
          <style>{ANSWER_CSS}</style>
          <style>{HANDOFF_CSS}</style>
          <header className="bubble-head">
            <strong>{petName}</strong>
            <span className="bubble-row">
              {alwaysToggle}
              {seeingToggle}
              {speakingIndicator}
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
                {exchange.failed ? (
                  <p className="bubble-error">{exchange.answer}</p>
                ) : (
                  <Answer text={exchange.answer} onCopy={copyText} />
                )}
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
            {talkStatus}
            {replyHint !== false && <p className="bubble-hints">{replyHint}</p>}
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
        <style>{ANSWER_CSS}</style>
        <style>{HANDOFF_CSS}</style>
        <div className="bubble-top">
          {chipList || <span />}
          <span className="bubble-row">
            {alwaysToggle}
            {seeingToggle}
            {speakingIndicator}
            {closeButton}
          </span>
        </div>
        {askedAloud && question !== null && (
          <p className="bubble-heard">
            <span className="bubble-sr">You said: </span>
            {question}
          </p>
        )}
        {answer}
        {handoffCard}
        {talkStatus}
        {field(`Ask ${petName}`)}
        <div className="bubble-row bubble-hints">
          {replyHint}
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

/** Whether the person asked the system for less motion. */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** How fast a line types in: quick enough to read along, slow enough to feel spoken. */
const TYPE_MS = 22;

/** `text` revealed a character at a time, or whole at once when motion is reduced. */
function useTyped(text: string): string {
  const [still] = useState(reducedMotion);
  const [shown, setShown] = useState(still ? text.length : 0);
  const [typing, setTyping] = useState(text);
  if (typing !== text) {
    setTyping(text);
    setShown(still ? text.length : 0);
  }
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => {
      setShown((count) => {
        if (count + 1 >= text.length) clearInterval(timer);
        return Math.min(count + 1, text.length);
      });
    }, TYPE_MS);
    return () => clearInterval(timer);
  }, [text, still]);
  return text.slice(0, shown);
}

/**
 * After setup, once: one line typed into the bubble that invites a real question about the
 * screen, with Try it now and Got it. Setup already said who Scout is and the key to press.
 * A screen reader hears the line whole; the typing is for the eyes only.
 */
function TryItInvite({
  hotkeyLabel,
  userName,
  onTry,
  onDismiss,
  onSay,
  indicator,
}: {
  hotkeyLabel: string;
  userName: string;
  onTry: () => void;
  onDismiss?: () => void;
  /** The line is said aloud once, as it appears. */
  onSay?: (text: string) => void;
  /** The speaking indicator, while Scout speaks. */
  indicator?: ReactNode;
}) {
  const name = userName.trim();
  const text = `${name === '' ? 'Here I am.' : `Here I am, ${name}.`} Ask me one real thing about your screen. Press ${hotkeyLabel} anytime.`;
  const typed = useTyped(text);
  const primary = useRef<HTMLButtonElement>(null);
  const said = useRef(false);
  const say = useEffectEvent(() => {
    if (said.current) return;
    said.current = true;
    onSay?.(text);
  });
  useEffect(() => {
    say();
    primary.current?.focus();
  }, []);
  return (
    <div className="bubble bubble--intro">
      <style>{BUBBLE_CSS}</style>
      <div className="bubble-hello">
        <p className="bubble-text bubble-typed" aria-hidden="true">
          <span data-testid="intro-typed">{typed}</span>
          {/* Holds the bubble at the line's full height, so it does not grow as it types. */}
          <span className="bubble-ghost">{text.slice(typed.length)}</span>
        </p>
        <p role="status" className="bubble-sr">
          {text}
        </p>
      </div>
      <div className="bubble-row">
        <button ref={primary} type="button" className="bubble-primary" onClick={onTry}>
          Try it now
        </button>
        <button type="button" className="bubble-quiet" onClick={onDismiss}>
          Got it
        </button>
        {indicator}
      </div>
    </div>
  );
}

export interface GreetingLineProps {
  petName: string;
  /** The one line the pet says as the app opens. */
  text: string;
  /** It left: the time ran out, or the person closed it. */
  onDone: () => void;
  /** The person clicked it: open the bubble to ask. */
  onOpen?: () => void;
  tail?: 'left' | 'right';
  /** How long it stays when nobody touches it. */
  holdMs?: number;
  /** A remark Scout made on its own: Not now quiets it for an hour and closes the line. */
  onNotNow?: () => void;
  /**
   * A button on the line. For a task an expert could take it opens the hand-off card (nothing
   * is sent yet); for a launch line that cannot think, Fix it opens Settings.
   */
  offer?: { label: string; onAccept: () => void };
}

/** How long the fade out takes before the line is gone. */
const LEAVE_MS = 300;

/**
 * One quiet line beside the pet that fades after a few seconds: the hello on a later launch,
 * or a remark from keeping an eye on things, which adds Not now and, sometimes, an offer.
 * Pointing at it or tabbing into it keeps it there; clicking it opens the bubble to ask.
 */
export function GreetingLine({
  petName,
  text,
  onDone,
  onOpen,
  tail,
  holdMs = 7_000,
  onNotNow,
  offer,
}: GreetingLineProps) {
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useEffectEvent(onDone);
  useEffect(() => {
    if (held) return;
    const fade = setTimeout(() => setLeaving(true), holdMs);
    const gone = setTimeout(() => done(), holdMs + LEAVE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [held, holdMs]);
  const hold = (): void => {
    setHeld(true);
    setLeaving(false);
  };
  return (
    <Speech tail={tail}>
      <div
        className="bubble bubble--line"
        data-leaving={leaving}
        onMouseEnter={hold}
        onMouseLeave={() => setHeld(false)}
        onFocus={hold}
        onBlur={() => setHeld(false)}
      >
        <style>{BUBBLE_CSS}</style>
        <div className="bubble-top">
          <button
            type="button"
            className="bubble-say"
            aria-label={`Ask ${petName} something`}
            onClick={onOpen}
          >
            <span role="status" aria-live="polite" className="bubble-text">
              {text}
            </span>
          </button>
          <button type="button" className="bubble-close" aria-label="Close" onClick={onDone}>
            ×
          </button>
        </div>
        {(onNotNow !== undefined || offer !== undefined) && (
          <div className="bubble-row">
            {offer !== undefined && (
              <button type="button" className="bubble-primary" onClick={offer.onAccept}>
                {offer.label}
              </button>
            )}
            {onNotNow !== undefined && (
              <button
                type="button"
                className="bubble-quiet"
                onClick={() => {
                  onNotNow();
                  onDone();
                }}
              >
                Not now
              </button>
            )}
          </div>
        )}
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
.bubble-speaking {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent;
  cursor: pointer;
}
.bubble-speaking:hover { background: #222845; }
.bubble-mic {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent;
  color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-mic:hover { background: #222845; color: ${t.color.text}; }
.bubble-mic[aria-pressed='true'] { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.bubble-mic:focus-visible { outline: 2px solid #7CB8F2; outline-offset: 2px; }
.bubble-toggle {
  flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px;
  border: 1px solid ${t.color.fieldLine}; border-radius: 999px; background: transparent;
  color: ${t.color.textMuted}; font: inherit; font-size: 12px; cursor: pointer;
}
.bubble-toggle::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%; background: ${t.color.fieldLine};
}
.bubble-toggle:hover { background: #222845; color: ${t.color.text}; }
.bubble-toggle[aria-checked='true'] { color: ${t.color.text}; border-color: ${t.color.gold}; }
.bubble-toggle[aria-checked='true']::before { background: ${t.color.gold}; }
.bubble-toggle:focus-visible { outline: 2px solid #7CB8F2; outline-offset: 2px; }
.bubble-heard {
  align-self: flex-end; max-width: 85%; margin: 0; padding: 6px 10px; border-radius: 10px 10px 4px 10px;
  background: #222845; color: #C9CEE0; font-size: 13px; line-height: 1.45;
}
.bubble-listening {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 12px; color: #C9CEE0;
}
.bubble-partial { flex-basis: 100%; font-size: 13px; line-height: 1.45; color: ${t.color.text}; }
.bubble-listening-dot {
  flex: none; width: 8px; height: 8px; border-radius: 50%; background: ${t.color.gold};
  animation: bubble-pulse 1.2s ease-in-out infinite;
}
.bubble-listening[data-state='hearing'] .bubble-listening-dot { background: #7CB8F2; }
@keyframes bubble-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .bubble-listening-dot { animation: none; } }
/* The host sets --tg-voice-level (0 to 1) from the audio as it plays. */
.bubble-speaking span {
  width: 3px; height: 14px; border-radius: 2px; background: ${t.color.gold};
  transform: scaleY(calc(0.3 + var(--tg-voice-level, 0.4) * 0.7)); transition: transform 90ms linear;
}
.bubble-speaking span:nth-child(2) { transform: scaleY(calc(0.3 + var(--tg-voice-level, 0.4))); }
@media (prefers-reduced-motion: reduce) {
  .bubble-speaking span, .bubble-speaking span:nth-child(2) { transform: scaleY(0.6); transition: none; }
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
.bubble-field { position: relative; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: ${t.color.textMuted}; }
.bubble-field input {
  height: 44px; box-sizing: border-box; padding: 0 44px 0 12px; border: 1px solid #7CB8F2;
  border-radius: 8px; background: ${t.color.field}; color: ${t.color.text}; font: inherit; font-size: 14px;
}
.bubble-field .bubble-mic { position: absolute; right: 6px; bottom: 8px; }
.bubble-row { display: flex; align-items: center; gap: 12px; }
.bubble-hello { display: grid; gap: 6px; }
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
.bubble-primary:focus-visible, .bubble-quiet:focus-visible, .bubble-close:focus-visible, .bubble-say:focus-visible {
  outline: 2px solid #7CB8F2; outline-offset: 2px;
}
.bubble--intro, .bubble--line { animation: bubble-in 220ms ease-out both; }
.bubble-typed { min-height: 3em; }
.bubble-ghost { visibility: hidden; }
.bubble-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.bubble--line { padding: 10px 8px 10px 14px; transition: opacity ${LEAVE_MS}ms ease, transform ${LEAVE_MS}ms ease; }
.bubble--line[data-leaving='true'] { opacity: 0; transform: translateY(4px); }
.bubble--line .bubble-top { align-items: center; }
.bubble-say {
  flex: 1; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
@keyframes bubble-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .bubble--intro, .bubble--line { animation: none; transition: none; }
  .bubble--line[data-leaving='true'] { transform: none; }
}
`;
