/**
 * Scout's bubble beside the dock pet: asks with what Scout can see, streams the answer,
 * and hosts the cards (connector confirm, drop, health).
 * Also the quiet GreetingLine. Contains CompanionBubble, GreetingLine, BubbleTalk and their
 * props. Used by the desktop panel window.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ConnectorConfirmParams,
  ContextSnapshot,
  FixTarget,
  StatusMark as StatusMarkValue,
  TurnEvent,
} from './shapes';
import { ANSWER_CSS, Answer } from './answer';
import { CONTROLS_CSS } from './controls/controls-styles';
import { StatusMark } from './status-mark';
import { CARD_CSS } from './card-styles';
import { CHAT_CSS } from './chat-styles';
import { CloseIcon, CollapseIcon, ExpandIcon, EyeIcon, MicIcon, SendIcon } from './chat-icons';
import { ScoutMark } from './scout-mark';
import { Keycap } from './controls';
import type { BeanClipData } from './theme/bean-clip';
import { ConnectorConfirmCard, type JobAnswer } from './connector-confirm';
import { InstallConfirm } from './setup/install-confirm';
import { DropCard, type DropOffer } from './drop-card';
import { useHostBridge } from './host-bridge';
import { JobLine, useRunningStep } from './job-line';
import { wantsHealthCheck } from './health-ask';
import { healthHeadline, healthRows } from './health';
import type { HealthRow } from './health';
import { HealthCard } from './health-card';
import { themeTokens as t, typeCss } from './theme/tokens';
import { stopStatus } from './stop-status';

/**
 * Talk to Scout, as the bubble sees it: the host holds the microphone and turns speech into
 * text; the bubble shows that it is listening and asks what was heard, as a spoken question.
 */
export interface BubbleTalk {
  /** Listening to the microphone, or turning what it heard into text. */
  state: 'idle' | 'listening' | 'hearing';
  /** Subscribes to each spoken question as it is heard; returns an unsubscribe function. */
  onHeard: (
    handler: (text: string, interrupted?: { turn: string; heard: number }) => void,
  ) => () => void;
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
  onOpenChat?: () => void;
  /** The full chat: the whole conversation, not just the latest answer. */
  expanded?: boolean;
  /** Back from the full chat to the bubble. */
  onCollapse?: () => void;
  /** Hides the bubble; Escape does the same. */
  onClose?: () => void;
  /** Which side of the bubble the pet is on: the speech tail points there. */
  tail?: 'left' | 'right';
  /** Whether the host is speaking now: the bubble shows it, with a way to stop. */
  speaking?: boolean;
  onStopSpeaking?: () => void;
  /** Talk to Scout: the mic button, the listening state and what was heard. */
  talk?: BubbleTalk;
  /** Whether Scout may look at the screen: the Seeing switch in the header. */
  seeing?: { on: boolean; onToggle: () => void };
  /** Something dropped on Scout: the drop card, until one of its buttons is pressed. */
  drop?: DropOffer;
  /** The drop card was answered or cancelled. */
  onDropDone?: () => void;
  /** The top status mark from the host: a muted row above the question box, never spoken. */
  status?: StatusMarkValue | null;
  /** Bean's idle strip, drawn still in Scout's mark beside lines Scout starts. */
  scout?: BeanClipData;
  /** Subscribes to text Home sends as the person (Ask Scout to fix it); returns an unsubscribe. */
  onAsk?: (handler: (text: string) => void) => () => void;
  /** Scout's own line the person clicked open on the quiet line: it becomes Scout's first message. */
  remark?: string;
}

/** A question and how it was answered, once it is over; no question when Scout spoke first. */
interface Exchange {
  question: string | null;
  answer: string;
  failed: boolean;
}

/** One removable part of what the companion can see. */
interface Chip {
  id: 'app' | 'selection';
  label: string;
}

/** Scout's reply in the full chat: its mark in a 24px gutter, the words beside it. */
function ScoutReply({ scout, children }: { scout: BeanClipData | undefined; children: ReactNode }) {
  return (
    <div className="bubble-scout">
      <ScoutMark {...(scout !== undefined ? { clip: scout } : {})} size={24} />
      <div className="bubble-scout-body">{children}</div>
    </div>
  );
}

/** What Scout is doing while a tool runs, in the mockup's words; the brain sends only the tool's name. */
function doingOf(tool: string): string {
  if (/search|web/.test(tool)) return 'searching the web';
  if (/read|screen|file|look/.test(tool)) return 'reading';
  return 'working on it';
}

function chipsOf(snapshot: ContextSnapshot | undefined): Chip[] {
  if (snapshot === undefined) return [];
  const chips: Chip[] = [];
  if (snapshot.app !== undefined) {
    const title = snapshot.app.windowTitle;
    chips.push({ id: 'app', label: title ? `${snapshot.app.name} · ${title}` : snapshot.app.name });
  }
  if (snapshot.selection !== undefined) chips.push({ id: 'selection', label: 'Selected text' });
  return chips;
}

/** The snapshot without the parts the person took out. */
function without(snapshot: ContextSnapshot, removed: ReadonlySet<Chip['id']>): ContextSnapshot {
  const { app, selection, ...rest } = snapshot;
  return {
    ...rest,
    ...(app !== undefined && !removed.has('app') ? { app } : {}),
    ...(selection !== undefined && !removed.has('selection') ? { selection } : {}),
  };
}

type Reply =
  | { state: 'idle' }
  // `steps`: where the text stood when each tool call began, to find where an ask's step starts.
  | { state: 'running'; turnId: string | null; text: string; steps?: number[]; doing?: string }
  | { state: 'done'; text: string; status?: string }
  | { state: 'failed'; text: string };

/** An app or expert install ask that carries the card's facts. */
const isInstallAsk = (c: ConnectorConfirmParams): boolean =>
  (c.tool === 'install_app' || c.tool === 'install_expert') && c.facts !== undefined;
const installKey = (c: ConnectorConfirmParams): string =>
  String(c.facts?.app ?? c.facts?.expert ?? c.approvalId);

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
  onOpenChat,
  expanded = false,
  onCollapse,
  onClose,
  tail,
  speaking = false,
  onStopSpeaking,
  talk,
  seeing,
  drop,
  onDropDone,
  status,
  remark,
  scout,
  onAsk,
}: CompanionBubbleProps) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState('');
  const [removed, setRemoved] = useState<ReadonlySet<Chip['id']>>(new Set());
  const [reply, setReply] = useState<Reply>({ state: 'idle' });
  // A change Scout wants to make in a connected app, waiting for Allow once, Always allow or Deny.
  // The brain can ask about several tools at once, so they queue oldest first and the card
  // shows the head; answering or dismissing it brings up the next.
  const [confirms, setConfirms] = useState<ConnectorConfirmParams[]>([]);
  // Install asks (an app or an expert) are one card each that stays after Allow and follows the
  // install, so they live apart: a dismiss or the turn's end must not take them away.
  const [installs, setInstalls] = useState<ConnectorConfirmParams[]>([]);
  // The header's words while an install card is working, keyed like the card.
  const [installing, setInstalling] = useState<Record<string, string>>({});
  const confirm = confirms[0] ?? null;
  // Asks dismissed since mount, so a late pull of the open cards cannot bring one back.
  const dismissed = useRef(new Set<string>());
  // Install asks whose Allow was pressed: their card follows the install and outlives the ask.
  const allowing = useRef(new Set<string>());
  const dropConfirms = (gone: (c: ConnectorConfirmParams) => boolean): void =>
    setConfirms((current) => {
      const next = current.filter((c) => !gone(c));
      return next.length === current.length ? current : next;
    });
  const [past, setPast] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const conversation = useRef<string | undefined>(undefined);
  const mine = useRef<string | null>(null);
  // The running question was asked aloud: the brain speaks its answer, and the bubble offers the key to reply.
  const askedSpoken = useRef(false);
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

  // Scout's own line (a wake's remark), kept until the person answers it; then it moves into
  // the log as an exchange with no question, so a follow-up never loses it.
  const [scoutLine, setScoutLine] = useState<string | null>(remark ?? null);
  const [lastRemark, setLastRemark] = useState(remark);
  if (remark !== lastRemark) {
    setLastRemark(remark);
    if (remark !== undefined) setScoutLine(remark);
  }

  // A new capture brings every chip back: removing is per question, not forever.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setRemoved(new Set());
  }

  /** Moves what is on show (the last answer, Scout's own line) into the log. */
  const keepShown = (): void => {
    const earlier: Exchange[] = [];
    if (question !== null && (reply.state === 'done' || reply.state === 'failed')) {
      earlier.push({ question, answer: reply.text, failed: reply.state === 'failed' });
    }
    if (scoutLine !== null) earlier.push({ question: null, answer: scoutLine, failed: false });
    if (earlier.length > 0) setPast((current) => [...current, ...earlier]);
    setScoutLine(null);
  };

  const onTurnEvent = useEffectEvent((event: TurnEvent) => {
    if (event.type === 'turn.completed' || event.type === 'turn.error') {
      const ended = event.turnId;
      dropConfirms((c) => c.turnId === ended);
    }
    switch (event.type) {
      case 'connector.confirm': {
        const { type: _type, ...params } = event;
        if (isInstallAsk(params)) {
          // One card per install: a new ask for the same one replaces it.
          const key = installKey(params);
          setInstalls((current) => [...current.filter((c) => installKey(c) !== key), params]);
          return;
        }
        // A repeat of a queued ask updates it in place; a new one waits its turn.
        setConfirms((current) =>
          current.some((c) => c.approvalId === params.approvalId)
            ? current.map((c) => (c.approvalId === params.approvalId ? params : c))
            : [...current, params],
        );
        return;
      }
      case 'connector.dismiss':
        // A brain ask closed (answered elsewhere, timed out, cancelled): its card goes. An
        // install card goes only while it still asks: once Allowed it follows the install and
        // the person closes it.
        dismissed.current.add(event.approvalId);
        dropConfirms((c) => c.approvalId === event.approvalId);
        setInstalls((current) =>
          current.filter(
            (c) => c.approvalId !== event.approvalId || allowing.current.has(c.approvalId),
          ),
        );
        return;
      case 'turn.started':
        // A background turn (Scout's own wake) runs on its own; it never answers here.
        if (reply.state !== 'running' || event.background === true) return;
        mine.current = event.turnId;
        conversation.current = event.conversationId;
        setReply({ state: 'running', turnId: event.turnId, text: '' });
        return;
      case 'turn.toolRequest':
        if (event.turnId !== mine.current) return;
        setReply((current) =>
          current.state === 'running'
            ? {
                ...current,
                steps: [...(current.steps ?? []), current.text.length],
                doing: doingOf(event.tool),
              }
            : current,
        );
        return;
      case 'turn.delta':
        if (event.turnId !== mine.current) return;
        setReply((current) =>
          current.state === 'running' ? { ...current, text: current.text + event.text } : current,
        );
        return;
      case 'turn.completed': {
        if (event.turnId !== mine.current) return;
        mine.current = null;
        // Nothing said, with a reason: a quiet status, never spoken.
        const status = stopStatus(event.text, event.stopReason);
        if (status !== null) {
          setReply({ state: 'done', text: '', status });
          return;
        }
        setReply({ state: 'done', text: event.text });
        if (askedSpoken.current) setSpokenReply(true);
        return;
      }
      case 'turn.error':
        if (event.turnId !== mine.current) return;
        mine.current = null;
        setReply({ state: 'failed', text: event.message });
        return;
      case 'pet.remark':
        // A wake's words with the bubble open: Scout's message, unless an answer is streaming.
        // What was on show (an answer, an earlier remark) goes into the log above it.
        if (reply.state === 'running' || health !== null) return;
        keepShown();
        setQuestion(null);
        setReply({ state: 'idle' });
        setScoutLine(event.text);
        return;
      default:
        return;
    }
  });
  useEffect(() => bridge.onTurnEvent(onTurnEvent), [bridge]);
  // Cards whose ask arrived before this bubble mounted (a relaunch) are shown again.
  useEffect(() => {
    let live = true;
    dismissed.current.clear();
    void bridge
      .openConfirms?.()
      .then((open) => {
        // An ask that closed while the reply was on its way stays closed.
        for (const event of open) {
          const gone =
            event.type === 'connector.confirm' && dismissed.current.has(event.approvalId);
          if (live && !gone) onTurnEvent(event);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge]);

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
  // The mic's tooltip is drawn like the header's (not the native title), and says the talk key.
  const micButton = talk !== undefined && (
    <span className="bubble-tgwrap">
      <button
        type="button"
        className="bubble-mic"
        aria-label={listening ? 'Stop listening' : `Talk to ${petName}`}
        aria-pressed={listening}
        aria-describedby="tip-mic"
        onClick={talk.onMic}
      >
        <MicIcon state={listening ? 'on' : 'plain'} />
      </button>
      <span className="bubble-tip bubble-tip--up" role="tooltip" id="tip-mic">
        {listening ? (
          'Stop listening'
        ) : (
          <>
            Hold <Keycap>{talk.keyLabel}</Keycap> to talk
          </>
        )}
      </span>
    </span>
  );
  // A header toggle: an icon button (pressed = on) with the tooltip the mockup draws beside it.
  const headToggle = (
    label: string,
    on: boolean,
    onToggle: () => void,
    icon: ReactNode,
    tip: { title: string; sub?: string },
  ) => (
    <span className="bubble-tgwrap">
      <button
        type="button"
        className="bubble-tg"
        aria-label={label}
        aria-pressed={on}
        aria-describedby={`tip-${label.replace(/\s/g, '-')}`}
        onClick={onToggle}
      >
        {icon}
      </button>
      <span className="bubble-tip" role="tooltip" id={`tip-${label.replace(/\s/g, '-')}`}>
        {tip.title}
        {tip.sub !== undefined && <span className="bubble-tip-sub">{tip.sub}</span>}
      </span>
    </span>
  );
  const alwaysToggle =
    talk?.always !== undefined &&
    headToggle(
      'Always listening',
      talk.always.on,
      talk.always.onToggle,
      <MicIcon state={talk.always.on ? 'on' : 'off'} />,
      talk.always.on
        ? { title: 'Always listening: on', sub: 'Click to turn off.' }
        : {
            title: 'Always listening: off',
            sub: `Click to turn on. Hold ${talk.keyLabel} to talk once.`,
          },
    );
  const seeingToggle =
    seeing !== undefined &&
    headToggle(
      'Seeing your screen',
      seeing.on,
      seeing.onToggle,
      <EyeIcon on={seeing.on} />,
      seeing.on
        ? { title: 'Seeing your screen: on', sub: 'Click to pause.' }
        : { title: 'Seeing your screen: off', sub: 'Click to let Scout see.' },
    );
  // What Scout is doing right now, in the header's second line.
  const talking =
    past.length > 0 ||
    question !== null ||
    scoutLine !== null ||
    confirms.length > 0 ||
    installs.length > 0;
  const headStatus =
    Object.values(installing)[0] ??
    (talk?.always === undefined && seeing === undefined
      ? 'Ready'
      : talk?.always?.on === true && seeing?.on === true
        ? 'Listening · seeing your screen'
        : talk?.always?.on === true
          ? 'Listening'
          : seeing?.on === true
            ? 'Seeing your screen'
            : talking
              ? 'Ready'
              : 'Not listening or looking');
  const expandButton = onOpenChat !== undefined && (
    <button
      type="button"
      className="bubble-tg"
      aria-label="Open full chat"
      title="Open full chat"
      onClick={onOpenChat}
    >
      <ExpandIcon />
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
  const runningStep = useRunningStep(bridge);
  const jobLine = runningStep !== null && <JobLine step={runningStep} />;
  const statusRow = status != null && (
    <StatusMark
      mark={status}
      variant="row"
      onFix={(target: FixTarget) => void bridge.openFix(target)}
    />
  );
  const replyHint = talk !== undefined && spokenReply && reply.state === 'done' && (
    <span>Hold {talk.keyLabel} to reply</span>
  );

  /**
   * Asks one question, with what the companion can see, and keeps the last answer above.
   * A spoken question may cut in on an answer still running: the brain stops that turn.
   */
  const submit = (
    text: string,
    context: ContextSnapshot | undefined,
    asSpoken = false,
    heard = asSpoken,
    withDrop = false,
    interrupted?: { turn: string; heard: number },
  ): void => {
    keepShown();
    healthRun.current += 1;
    setHealth(null);
    if (wantsHealthCheck(text)) {
      checkHealth(text, asSpoken);
      return;
    }
    setQuestion(text);
    setReply({ state: 'running', turnId: null, text: '' });
    setSpokenReply(false);
    setAskedAloud(heard);
    mine.current = null;
    askedSpoken.current = asSpoken;
    bridge
      .ask({
        petId,
        ...(conversation.current !== undefined ? { conversationId: conversation.current } : {}),
        text,
        ...(context !== undefined ? { snapshot: context } : {}),
        ...(asSpoken ? { spoken: true } : {}),
        // Only a button on the drop card sends the dropped item, never a spoken ask.
        ...(withDrop ? { drop: true } : {}),
        ...(interrupted !== undefined ? { interrupted } : {}),
      })
      .then(({ turnId }) => {
        mine.current ??= turnId;
      })
      .catch((error: unknown) =>
        setReply({
          state: 'failed',
          text: error instanceof Error ? error.message : 'Tagalong could not reach its brain.',
        }),
      );
  };

  /**
   * "Scout, what's wrong?": the health card instead of a turn, read from the host with no
   * model call, so it works when Scout cannot think. An answer still running is stopped.
   * Health is a vital sign: shown on the card, never said aloud.
   */
  const checkHealth = (text: string, asSpoken: boolean): void => {
    if (mine.current !== null) void bridge.interrupt(mine.current);
    mine.current = null;
    askedSpoken.current = false;
    setQuestion(text);
    setAskedAloud(asSpoken);
    setSpokenReply(false);
    setReply({ state: 'idle' });
    setHealth({ rows: null });
    const run = healthRun.current;
    bridge
      .checkHealth()
      .then((facts) => {
        if (run !== healthRun.current) return;
        const rows = healthRows(facts);
        const headline = healthHeadline(rows);
        setHealth({ rows });
        // Kept as the answer, so the full chat's history shows what the check said.
        setReply({ state: 'done', text: headline });
      })
      .catch(() => {
        if (run !== healthRun.current) return;
        setHealth(null);
        setReply({ state: 'failed', text: 'Health check failed.' });
      });
  };

  const send = (): void => {
    const text = draft.trim();
    if (text === '' || reply.state === 'running') return;
    setDraft('');
    // Asked as typed: the mind decides what of its answer is said aloud.
    submit(text, snapshot === undefined ? undefined : without(snapshot, removed));
  };

  // A spoken question arrives from the host: ask it, once per new `seq`.
  const askHeard = useEffectEvent((text: string, interrupted?: { turn: string; heard: number }) => {
    if (text.trim() === '') return;
    submit(
      text,
      snapshot === undefined ? undefined : without(snapshot, removed),
      true,
      true,
      false,
      interrupted,
    );
  });
  const onHeard = talk?.onHeard;
  useEffect(() => onHeard?.((text, interrupted) => askHeard(text, interrupted)), [onHeard]);

  // Home asks on the person's behalf: shown and sent as if typed, with no screen snapshot.
  const askFromHome = useEffectEvent((text: string) => {
    if (text.trim() === '') return;
    // `heard` keeps the person's words on screen above Scout's answer, though nothing was said.
    submit(text, undefined, false, true);
  });
  useEffect(() => onAsk?.((text) => askFromHome(text)), [onAsk]);

  // Barge-in: talking over Scout stops the answer still streaming, not only its voice,
  // and nothing more of it is said.
  const bargeIn = useEffectEvent(() => {
    if (reply.state !== 'running') return;
    if (mine.current !== null) void bridge.interrupt(mine.current);
    // The bubble keeps what was said so far and ignores the rest of the stopped turn.
    mine.current = null;
    setReply({ state: 'done', text: reply.text });
  });
  const onListen = talk?.onListen;
  useEffect(() => onListen?.(() => bargeIn()), [onListen]);

  const stop = (): void => {
    if (mine.current !== null) void bridge.interrupt(mine.current);
  };

  // The chat opens on, and follows, the newest message. Only new content moves it, never typing.
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The composer grows with its text, up to a few lines, then scrolls.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);
  const streamed = reply.state === 'idle' ? '' : reply.text;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = log.current;
      if (element !== null) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    past.length,
    question,
    streamed,
    scoutLine,
    expanded,
    confirm,
    installs.length,
    health,
    openDrop,
  ]);

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
  // A permission card leads with Scout's words for its own step, and the brain cuts them short.
  // So while it is open the stream stops where that step begins (the last tool call before the
  // ask's own); the card carries the rest, and the full text returns when the card closes.
  // The ask is the newest tool call (parallel calls share one position), so its step starts
  // at the last position before that; none before it means the whole text is its step.
  const askStep =
    confirm?.options !== undefined && reply.state === 'running' && confirm.turnId === reply.turnId
      ? Math.max(0, ...(reply.steps ?? []).filter((at) => at < Math.max(...(reply.steps ?? [0]))))
      : null;
  const shownText =
    reply.state !== 'running' ? '' : askStep === null ? reply.text : reply.text.slice(0, askStep);
  const turnAnswer = (
    <>
      {reply.state === 'running' && (
        <div
          className={reply.text === '' ? 'bubble-answer' : 'bubble-answer bubble-streaming'}
          aria-live="polite"
        >
          {shownText.trim() !== '' && <Answer text={shownText} />}
          <div className="bubble-live">
            {reply.text === '' ? (
              <span className="bubble-thinking">
                <span className="bubble-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {petName} is {reply.doing ?? 'thinking'}…
              </span>
            ) : (
              <span />
            )}
            <button type="button" className="bubble-quiet bubble-stop" onClick={stop}>
              <i aria-hidden="true" />
              Stop
            </button>
          </div>
        </div>
      )}
      {reply.state === 'done' && reply.status !== undefined && (
        <p className="bubble-status">{reply.status}</p>
      )}
      {reply.state === 'done' && reply.status === undefined && (
        <div className="bubble-answer">
          <Answer text={reply.text} gist={expanded} />
        </div>
      )}
      {reply.state === 'failed' && (
        <p role="alert" className="bubble-error">
          {reply.text}
        </p>
      )}
    </>
  );
  // A line Scout starts: its mark and name above the words.
  const scoutSays = (words: string) => (
    <div className="bubble-scoutmsg">
      <span className="bubble-who">
        <ScoutMark {...(scout !== undefined ? { clip: scout } : {})} />
        <span>{petName}</span>
      </span>
      <Answer text={words} />
    </div>
  );
  // Scout's own line, until the person answers it (then it is in the log).
  const scoutMessage = scoutLine !== null && scoutSays(scoutLine);
  // A health check answers with its card, in the answer's place.
  const answer =
    health === null ? (
      turnAnswer
    ) : (
      <HealthCard
        rows={health.rows}
        onFix={(target: FixTarget) => void bridge.openFix(target)}
        onOpenLogs={() => void bridge.openLogs()}
      />
    );
  const answerConfirm = (decision: 'once' | 'always' | 'deny'): void => {
    if (confirm === null) return;
    const { approvalId } = confirm;
    // The card goes once the answer got through. A refusal (the brain is offline) leaves it up
    // to click again: the brain does not replay an ask after a plain reconnect.
    void bridge.approveTool(approvalId, decision).then(
      () => dropConfirms((c) => c.approvalId === approvalId),
      () => undefined,
    );
  };
  const replyConfirm = (answer: JobAnswer): void => {
    if (confirm === null) return;
    const { approvalId } = confirm;
    void bridge.answerJobAsk(approvalId, answer).then(
      () => dropConfirms((c) => c.approvalId === approvalId),
      () => undefined,
    );
  };
  const closeDrop = (): void => {
    setOpenDrop(undefined);
    onDropDone?.();
  };
  // Install cards sit under Scout's sentence in the same reply: the current answer, else the
  // last exchange's. With no reply to join (Scout's own line, a failed turn) they get their own.
  const installCards = installs.map((install) => (
    <InstallConfirm
      key={install.approvalId}
      confirm={install}
      onAllowing={(on) =>
        on ? allowing.current.add(install.approvalId) : allowing.current.delete(install.approvalId)
      }
      onGone={() => setInstalls((current) => current.filter((c) => c !== install))}
      onTry={(text) => submit(text, undefined)}
      onRetry={(name) => submit(`Set up ${name} again`, undefined)}
      onWorking={(words) =>
        setInstalling((current) => {
          const key = installKey(install);
          const { [key]: _gone, ...rest } = current;
          return words === null ? rest : { ...rest, [key]: words };
        })
      }
    />
  ));
  const lastPast = past[past.length - 1];
  const installsInReply =
    expanded &&
    installs.length > 0 &&
    scoutLine === null &&
    (question !== null
      ? health === null
      : lastPast !== undefined && lastPast.question !== null && !lastPast.failed);
  const cards = (
    <>
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
              false,
              true,
            );
          }}
        />
      )}
      {installs.length > 0 &&
        !installsInReply &&
        (expanded ? <ScoutReply scout={scout}>{installCards}</ScoutReply> : installCards)}
      {confirm !== null && (
        <ConnectorConfirmCard
          key={confirm.approvalId}
          confirm={confirm}
          onAnswer={answerConfirm}
          onReply={replyConfirm}
        />
      )}
    </>
  );
  // Replying to Scout's own line, not asking cold.
  const replying =
    scoutLine !== null || (question === null && past[past.length - 1]?.question === null);
  const field = (label: string, inChat = false) => (
    <label className="bubble-field">
      <span className="bubble-sr">{label}</span>
      {/* Named outright: the buttons inside the label would join its name in Chromium. */}
      <textarea
        ref={box}
        rows={1}
        aria-label={label}
        placeholder={`${replying ? 'Reply to' : 'Ask'} ${petName}…${
          talk === undefined ? '' : ` or hold ${talk.keyLabel} to talk`
        }`}
        value={draft}
        autoFocus
        data-chat={inChat ? 'true' : undefined}
        aria-busy={reply.state === 'running' ? 'true' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Shift+Enter is left to the browser: it adds the line.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      {micButton}
      <button
        type="button"
        className="bubble-send"
        aria-label="Send"
        disabled={draft.trim() === '' || reply.state === 'running'}
        onClick={send}
      >
        <SendIcon />
      </button>
    </label>
  );

  const closeButton = onClose !== undefined && (
    <button type="button" className="bubble-close bubble-tg" aria-label="Close" onClick={onClose}>
      <CloseIcon />
    </button>
  );

  // The header of both windows: Scout's mark, name and what it is doing, the toggles and the exits.
  const header = (quick: boolean) => (
    <header className={quick ? 'bubble-head bubble-head--quick' : 'bubble-head'}>
      <ScoutMark {...(scout !== undefined ? { clip: scout } : {})} size={quick ? 28 : 32} />
      <span className="bubble-headwho">
        <strong>{petName}</strong>
        <span className="bubble-headstatus" data-testid="head-status">
          <span className="bubble-priv" aria-hidden="true" />
          {headStatus}
        </span>
      </span>
      <span className="bubble-row">
        {alwaysToggle}
        {seeingToggle}
        {speakingIndicator}
        {(alwaysToggle || seeingToggle) && <span className="bubble-sep" aria-hidden="true" />}
        {quick
          ? expandButton
          : onCollapse !== undefined && (
              <button
                type="button"
                className="bubble-tg"
                aria-label="Back to bubble"
                title="Back to bubble"
                onClick={onCollapse}
              >
                <CollapseIcon />
              </button>
            )}
        {closeButton}
      </span>
    </header>
  );

  if (expanded) {
    return (
      <Speech tail={tail}>
        <div className="bubble bubble--chat on-navy">
          <style>{CONTROLS_CSS}</style>
          <style>{BUBBLE_CSS}</style>
          <style>{ANSWER_CSS}</style>
          <style>{CARD_CSS}</style>
          <style>{CHAT_CSS}</style>
          {header(false)}
          <div
            ref={log}
            className="bubble-log"
            role="log"
            aria-label={`Conversation with ${petName}`}
          >
            {past.length === 0 && question === null && scoutLine === null && (
              <div className="bubble-empty">
                <ScoutMark {...(scout !== undefined ? { clip: scout } : {})} size={48} />
                <p>Ask {petName} anything about what is on your screen.</p>
                {talk !== undefined && (
                  <span className="bubble-empty-key">
                    Hold <Keycap>{talk.keyLabel}</Keycap> to talk
                  </span>
                )}
              </div>
            )}
            {past.map((exchange, index) => (
              <div key={index} className="bubble-exchange">
                {exchange.question !== null && <p className="bubble-mine">{exchange.question}</p>}
                {exchange.question === null ? (
                  scoutSays(exchange.answer)
                ) : exchange.failed ? (
                  <p className="bubble-error">{exchange.answer}</p>
                ) : (
                  <ScoutReply scout={scout}>
                    <Answer text={exchange.answer} gist />
                    {installsInReply &&
                      question === null &&
                      index === past.length - 1 &&
                      installCards}
                  </ScoutReply>
                )}
              </div>
            ))}
            {scoutLine !== null && <div className="bubble-exchange">{scoutMessage}</div>}
            {question !== null && (
              <div className="bubble-exchange">
                <p className="bubble-mine">{question}</p>
                <ScoutReply scout={scout}>
                  {answer}
                  {installsInReply && installCards}
                </ScoutReply>
              </div>
            )}
            {cards}
          </div>
          <footer className="bubble-foot">
            {chipList}
            {jobLine}
            {statusRow}
            {talkStatus}
            {replyHint !== false && <p className="bubble-hints">{replyHint}</p>}
            {field(`Message ${petName}`, true)}
          </footer>
        </div>
      </Speech>
    );
  }

  return (
    <Speech tail={tail}>
      <div className="bubble bubble--quick on-navy">
        <style>{CONTROLS_CSS}</style>
        <style>{BUBBLE_CSS}</style>
        <style>{ANSWER_CSS}</style>
        <style>{CARD_CSS}</style>
        <style>{CHAT_CSS}</style>
        {header(true)}
        <div className="bubble-compact">
          {chipList}
          {askedAloud && question !== null && (
            <p className="bubble-heard">
              <span className="bubble-sr">You said: </span>
              {question}
            </p>
          )}
          {scoutMessage}
          {answer}
          {cards}
          {jobLine}
          {statusRow}
          {talkStatus}
          {field(`Ask ${petName}`)}
          {replyHint !== false && <p className="bubble-hints">{replyHint}</p>}
        </div>
      </div>
    </Speech>
  );
}

export interface GreetingLineProps {
  petName: string;
  /** The one line the pet says as the app opens. */
  text?: string;
  /** Instead of words: a status mark's row (a launch where Scout cannot think), never spoken. */
  status?: StatusMarkValue;
  /** The status row's Fix it. */
  onFix?: (target: FixTarget) => void;
  /** It left: the time ran out, or the person closed it. */
  onDone: () => void;
  /** Whether the host is reading the line aloud: three bars show it. */
  speaking?: boolean;
  /** Bean's idle strip, drawn still in Scout's mark. */
  scout?: BeanClipData;
  /** The person clicked it: open the bubble to ask, carrying the line so it is not lost. */
  onOpen?: (text: string) => void;
  tail?: 'left' | 'right';
  /** How long it stays when nobody touches it. */
  holdMs?: number;
}

/** How long the fade out takes before the line is gone. */
const LEAVE_MS = 300;

/**
 * One quiet line beside the pet that fades after a few seconds: the hello on a later launch,
 * or a remark Scout makes on its own.
 * Pointing at it or tabbing into it keeps it there; clicking it opens the bubble to ask.
 */
export function GreetingLine({
  petName,
  text,
  onDone,
  onOpen,
  tail,
  holdMs = 7_000,
  status,
  onFix,
  speaking = false,
  scout,
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
        className="bubble bubble--line on-navy"
        data-leaving={leaving}
        onMouseEnter={hold}
        onMouseLeave={() => setHeld(false)}
        onFocus={hold}
        onBlur={() => setHeld(false)}
      >
        <style>{CONTROLS_CSS}</style>
        <style>{BUBBLE_CSS}</style>
        <style>{CHAT_CSS}</style>
        <div className="bubble-top">
          {status !== undefined ? (
            <StatusMark mark={status} variant="row" {...(onFix !== undefined ? { onFix } : {})} />
          ) : (
            <button
              type="button"
              className="bubble-say"
              aria-label={`Ask ${petName} something`}
              onClick={() => onOpen?.(text ?? '')}
            >
              <span className="bubble-who">
                <ScoutMark {...(scout !== undefined ? { clip: scout } : {})} />
                <span>{petName}</span>
                {speaking && (
                  <span className="bubble-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </span>
              <span role="status" aria-live="polite" className="bubble-text">
                {text}
              </span>
              <span className="bubble-hint">Click to reply</span>
            </button>
          )}
          <button type="button" className="bubble-close" aria-label="Close" onClick={onDone}>
            <CloseIcon />
          </button>
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
.bubble-foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-top: 1px solid #262C4A; }
.bubble-top { display: flex; align-items: flex-start; justify-content: flex-end; gap: 8px; }
.bubble-close {
  flex: none; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent;
  color: ${t.color.textMuted}; ${typeCss('title')}; cursor: pointer;
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
.bubble-mic:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
.bubble-heard {
  align-self: flex-end; max-width: 85%; margin: 0; padding: 6px 10px; border-radius: 10px 10px 4px 10px;
  background: #222845; color: #C9CEE0; ${typeCss('body')};
}
.bubble-listening {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; ${typeCss('small')}; color: #C9CEE0;
}
.bubble-partial { flex-basis: 100%; ${typeCss('body')}; color: ${t.color.text}; }
.bubble-listening-dot {
  flex: none; width: 8px; height: 8px; border-radius: 50%; background: ${t.color.gold};
  animation: bubble-pulse 1.2s ease-in-out infinite;
}
.bubble-listening[data-state='hearing'] .bubble-listening-dot { background: #7CB8F2; }
@keyframes bubble-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .bubble-listening-dot { animation: none; } }
/* The host sets --tg-voice-level (0 to 1) from the audio as it plays. */
.bubble-speaking span, .bubble-bars span {
  width: 3px; height: 14px; border-radius: 2px; background: ${t.color.gold};
  transform: scaleY(calc(0.3 + var(--tg-voice-level, 0.4) * 0.7)); transition: transform 90ms linear;
}
.bubble-speaking span:nth-child(2), .bubble-bars span:nth-child(2) { transform: scaleY(calc(0.3 + var(--tg-voice-level, 0.4))); }
@media (prefers-reduced-motion: reduce) {
  .bubble-speaking span, .bubble-speaking span:nth-child(2),
  .bubble-bars span, .bubble-bars span:nth-child(2) { transform: scaleY(0.6); transition: none; }
}
.bubble-text { margin: 0; ${typeCss('bodyLead')}; white-space: pre-wrap; overflow-wrap: anywhere; }
.bubble-status { margin: 0; color: #C9CEE0; ${typeCss('small')}; }
.bubble-answer { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.bubble-error { margin: 0; padding: 8px 12px; border-radius: 6px; background: #3a1d2a; color: #ffb4c0; ${typeCss('body')}; }
.bubble-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.bubble-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 28px;
  padding: 0 4px 0 10px; border-radius: 999px; background: #222845; color: #C9CEE0; ${typeCss('small')};
}
.bubble-chip button {
  width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent;
  color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-row { display: flex; align-items: center; gap: 12px; }
.bubble-hints { ${typeCss('caption')}; color: ${t.color.textMuted}; }
.bubble-primary {
  height: 36px; padding: 0 16px; border: 0; border-radius: 8px; background: ${t.color.gold};
  color: ${t.color.goldInk}; font: inherit; font-weight: 600; cursor: pointer;
}
.bubble-quiet {
  align-self: flex-start; min-height: 28px; padding: 0 10px; border: 1px solid ${t.color.fieldLine};
  border-radius: 6px; background: transparent; color: #C9CEE0; font: inherit; ${typeCss('small')}; cursor: pointer;
}
.bubble-primary:focus-visible, .bubble-quiet:focus-visible, .bubble-close:focus-visible, .bubble-say:focus-visible {
  outline: 2px solid var(--tg-focus); outline-offset: 2px;
}
.bubble--line { animation: bubble-in 220ms ease-out both; }
.bubble-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.bubble--line { transition: opacity ${LEAVE_MS}ms ease, transform ${LEAVE_MS}ms ease; }
.bubble--line[data-leaving='true'] { opacity: 0; transform: translateY(4px); }
@keyframes bubble-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .bubble--line { animation: none; transition: none; }
  .bubble--line[data-leaving='true'] { transform: none; }
}
`;
