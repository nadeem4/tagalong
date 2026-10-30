/**
 * The panel window's page: Scout's bubble beside the pet and the full chat one click behind
 * it, with talk-to-Scout (talk.ts), Scout's voice, the health check (health-facts.ts) and the
 * cards Scout opens (keep-an-eye lines, routine results, pick-up, dropped items).
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ApprovedReport,
  CompanionBubble,
  GreetingLine,
  HostBridgeProvider,
  QueueMouth,
  SpeechQueue,
} from '@tagalong/ui';
import type {
  ContextSnapshot,
  PetRemarkParams,
  PickUpReadyParams,
  RoutineResultParams,
  StatusMark,
} from '@tagalong/protocol';
import type { DropOffer } from '@tagalong/ui';
// Bundled, not fetched: the bubble's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './app.css';
import '../../shared/ipc';
import type { GreetLine } from '../../shared/ipc';
import { prepareLine } from './voice-player';
import { DEFAULT_TALK_KEY, panelSettings } from './panel-settings';
import type { PanelSettings } from './panel-settings';
import { useTalk } from './talk';
import { installVoiceSeam } from './voice-seam';
import type { FixTarget, HostBridge } from '@tagalong/ui';
import { gatherHealth, HEALTH_TEST_BUDGET_MS } from './health-facts';
import { listMicrophones } from './mic';

/** The full chat's height; the bubble measures its own. Matches main's PANEL_HEIGHT. */
const CHAT_HEIGHT = 520;

const unavailable = (): Promise<never> => Promise.reject(new Error('not available here'));

/**
 * The bubble's bridge: the preload's, plus the health check ("Scout, what's wrong?"), read
 * from calls Home and Settings already make, its Fix it, which opens the right place, and
 * Open logs folder.
 */
function bubbleBridge(): HostBridge {
  const bridge = window.tagalong;
  const host = window.tagalongHost;
  return {
    ...bridge,
    checkHealth: () =>
      gatherHealth({
        getHostView: () => host.getHostView(),
        checkClaudeSignIn: () => host.checkClaudeSignIn(),
        listExperts: () => bridge.listExperts?.() ?? unavailable(),
        testExpert: (id) => bridge.testExpert?.(id) ?? unavailable(),
        listConnections: () => bridge.listConnections?.() ?? unavailable(),
        listMicrophones: () => listMicrophones(),
        voiceModels: () => host.voiceModels(),
        testBudgetMs: HEALTH_TEST_BUDGET_MS,
      }),
    openFix: (target: FixTarget) => host.openSettings(target),
    openLogs: () => host.openLogsFolder(),
  };
}

/**
 * The companion's bubble beside the pet, with the full chat one click behind it. The
 * snapshot arrives from main on every hotkey press, so the chips always describe the
 * capture that opened the bubble rather than a stale one. The window is sized to what it
 * shows: the bubble measures itself, the chat asks for its full height.
 */
function Panel() {
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [petId, setPetId] = useState<string | null>(null);
  const [petName, setPetName] = useState('Scout');
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'bubble' | 'chat'>('bubble');
  const [greeting, setGreeting] = useState(false);
  const [line, setLine] = useState<GreetLine | null>(null);
  // A line Scout says on its own, from keeping an eye on things, with Not now on it.
  const [remark, setRemark] = useState<PetRemarkParams | null>(null);
  // A routine's result: a quiet line that opens to the full answer in its conversation.
  const [routine, setRoutine] = useState<RoutineResultParams | null>(null);
  // Pick up where you left off: the card Pick up on the line opened.
  const [pickUp, setPickUp] = useState<PickUpReadyParams | null>(null);
  const [resume, setResume] = useState<{
    conversationId: string;
    question: string;
    answer: string;
  } | null>(null);
  // Something dropped on Scout: its card, until a button on it is pressed.
  const [drop, setDrop] = useState<DropOffer | null>(null);
  // Which side of the pet this window sits on; the speech tail points the other way, at it.
  const [side, setSide] = useState<'left' | 'right'>('left');
  const root = useRef<HTMLDivElement>(null);
  // Scout talks: one line at a time; main decides who says it, or that it stays quiet.
  const [speaking, setSpeaking] = useState(false);
  // A spoken answer still streaming in: the follow-up window waits for the end of all of it.
  const [answering, setAnswering] = useState(false);
  const [mouth] = useState(
    () =>
      new QueueMouth(
        new SpeechQueue({ prepare: (text) => prepareLine(text), onSpeaking: setSpeaking }),
        { onAnswering: setAnswering },
      ),
  );
  // Talk to Scout: the talk key held, or the mic button. Talking cuts Scout off at once.
  const [talkKey, setTalkKey] = useState(DEFAULT_TALK_KEY);
  const [microphoneId, setMicrophoneId] = useState<string | undefined>(undefined);
  // Seeing: off is sight paused, the same switch as the pause key and the tray.
  const [seeing, setSeeing] = useState(true);
  const [bridge] = useState(bubbleBridge);
  // The top status mark: a muted row in the bubble, the same mark as the tag on Scout.
  const [status, setStatus] = useState<StatusMark | null>(null);
  function apply(next: PanelSettings): void {
    setTalkKey(next.talkKey);
    setMicrophoneId(next.microphoneId);
  }
  const {
    talk,
    cancel: cancelTalk,
    hush,
  } = useTalk({
    keyLabel: talkKey,
    microphoneId,
    speaking,
    answering,
    onBegin: () => {
      mouth.stop();
      setGreeting(false);
      setLine(null);
      setRemark(null);
      setRoutine(null);
    },
  });

  useEffect(() => {
    void window.tagalongHost.getSightPaused().then((paused) => setSeeing(!paused));
    return window.tagalongHost.onSightPause((paused) => setSeeing(!paused));
  }, []);

  // The stop key cuts Scout off mid-sentence, and a watch that fires says its reason aloud.
  // A watch with no reason says nothing: its card shows the condition.
  useEffect(
    () =>
      window.tagalongHost.onStopVoice(() => {
        hush();
        mouth.stop();
      }),
    [mouth, hush],
  );
  useEffect(
    () =>
      window.tagalong.onTurnEvent((event) => {
        if (event.type === 'watch.fired' && event.message !== '') mouth.say(event.message);
      }),
    [mouth],
  );

  // Transparent around the bubble's rounded corners; the window itself is transparent.
  useEffect(() => {
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => window.tagalongHost.onPanelSide(setSide), []);

  useEffect(
    () =>
      window.tagalongHost.onGreet(() => {
        setMode('bubble');
        setLine(null);
        // The hello's line, if any, is the mind's: it comes to the bubble as a check-in remark.
        setGreeting(true);
      }),
    [],
  );

  useEffect(() => {
    void window.tagalongHost
      .getStatusMark()
      .then(setStatus)
      .catch(() => undefined);
    return window.tagalongHost.onStatusMark(setStatus);
  }, []);

  // A later launch: one quiet line, which fades and hides the window unless touched. A brain
  // that cannot think comes as a status mark: shown with Fix it, never said aloud.
  useEffect(
    () =>
      window.tagalongHost.onGreetLine((next) => {
        setMode('bubble');
        setLine(next);
        if ('text' in next) mouth.say(next.text);
      }),
    [mouth],
  );

  useEffect(
    () =>
      window.tagalongHost.onRemark((next) => {
        setMode('bubble');
        setLine(null);
        setRemark(next);
        mouth.say(next.text);
      }),
    [mouth],
  );

  useEffect(
    () =>
      window.tagalongHost.onRoutine((result, how) => {
        if (how.speak) mouth.say(result.text || result.line);
        if (!how.line) return;
        setMode('bubble');
        setLine(null);
        setRemark(null);
        setRoutine(result);
      }),
    [mouth],
  );

  // The window follows what is shown: the chat at its full height, the bubble at its own.
  useEffect(() => {
    if (mode === 'chat') {
      void window.tagalongHost.fitPanel(CHAT_HEIGHT);
      return;
    }
    const element = root.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      void window.tagalongHost.fitPanel(element.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, petId]);

  function dismissGreeting(): void {
    setGreeting(false);
    mouth.stop();
    void window.tagalongHost.hidePanel();
  }

  useEffect(() => {
    void window.tagalongHost.getContext().then(setSnapshot);
    // A hotkey press means a question: it ends the hello and brings back the bubble.
    return window.tagalongHost.onContext((next) => {
      setSnapshot(next);
      setGreeting(false);
      setLine(null);
      setRemark(null);
      setRoutine(null);
      setResume(null);
      setDrop(null);
    });
  }, []);

  // A drop on the figure: main opened the bubble and hands over the card for it.
  useEffect(
    () =>
      window.tagalongHost.onDrop((offer) => {
        setMode('bubble');
        setGreeting(false);
        setLine(null);
        setRemark(null);
        setRoutine(null);
        setResume(null);
        setDrop(offer);
      }),
    [],
  );

  // A broken hotkey is invisible by nature: the user presses a key and nothing happens.
  // The panel is the surface they can still reach — through the tray — so it says which
  // binding failed. Read once for a panel opened after the failure, and subscribed so one
  // already open stops showing a problem the user has since fixed.
  useEffect(() => {
    void window.tagalongHost
      .getHostView()
      .then((view) => setHotkeyProblem(view.hotkeyError ?? null));
    return window.tagalongHost.onHotkeyProblem(setHotkeyProblem);
  }, []);

  // Opens on Scout.
  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([pets, view]) => {
        const preferred = pets[0];
        setPetId(preferred?.id ?? null);
        if (preferred !== undefined) setPetName(preferred.name);
        apply(panelSettings(view.settings));
      })
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

  // A save in Settings or Home reaches an open panel at once: keys, microphone, name.
  useEffect(
    () => window.tagalongHost.onSettingsChanged((settings) => apply(panelSettings(settings))),
    [],
  );

  if (petId === null) return <p className="settings__note">Waking Scout…</p>;

  return (
    <HostBridgeProvider bridge={bridge}>
      {/* Pinned to the bottom of the window, level with the pet, whatever the window's height:
          a window still at the full chat's height must not leave the bubble floating above. */}
      <div className="panel-anchor">
        <div ref={root}>
          {hotkeyProblem !== null && (
            <p className="settings__error" role="status" data-testid="hotkey-problem">
              {hotkeyProblem}{' '}
              <button type="button" onClick={() => void window.tagalongHost.openSettings()}>
                Open Settings
              </button>
            </p>
          )}
          {/* Above whatever the panel shows. A panel main brought up just for the card was never
              focused and will never blur, so the card hides it again, like the lines below do;
              a panel that was already showing is never hidden (the report only asks if main
              brought it up). */}
          <ApprovedReport onHide={() => void window.tagalongHost.hidePanel()} />
          {routine !== null ? (
            <GreetingLine
              petName={petName}
              text={routine.line}
              tail={side === 'left' ? 'right' : 'left'}
              holdMs={12_000}
              onDone={() => {
                setRoutine(null);
                mouth.stop();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => {
                setRoutine(null);
                setResume(
                  routine.conversationId === undefined
                    ? null
                    : {
                        conversationId: routine.conversationId,
                        question: routine.name,
                        answer: routine.text,
                      },
                );
              }}
            />
          ) : remark !== null ? (
            <GreetingLine
              petName={petName}
              text={remark.text}
              tail={side === 'left' ? 'right' : 'left'}
              holdMs={12_000}
              onDone={() => {
                setRemark(null);
                mouth.stop();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => setRemark(null)}
              onNotNow={() => void window.tagalongHost.remarkNotNow()}
              {...(remark.offer !== undefined
                ? {
                    offer: {
                      label: 'Hand it over',
                      // The bubble comes back first, so it is there to show the card.
                      onAccept: () => {
                        setRemark(null);
                        void window.tagalongHost.remarkAccept(remark.remarkId);
                      },
                    },
                  }
                : {})}
            />
          ) : line !== null && 'status' in line ? (
            <GreetingLine
              petName={petName}
              status={{ id: line.status }}
              tail={side === 'left' ? 'right' : 'left'}
              onDone={() => {
                setLine(null);
                void window.tagalongHost.hidePanel();
              }}
              onFix={(target) => {
                setLine(null);
                void window.tagalongHost.openSettings(target);
                void window.tagalongHost.hidePanel();
              }}
            />
          ) : line !== null ? (
            <GreetingLine
              petName={petName}
              text={line.text}
              tail={side === 'left' ? 'right' : 'left'}
              onDone={() => {
                setLine(null);
                mouth.stop();
                // A pick-up let go (Not now, the close, or the fade) is dropped.
                if (line.pickUp !== undefined) void window.tagalong.dismissPickUp?.();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => setLine(null)}
              {...(line.pickUp !== undefined
                ? {
                    onNotNow: () => undefined,
                    offer: {
                      label: 'Pick up',
                      // The bubble opens on the card; nothing opens until a button there.
                      onAccept: () => {
                        setPickUp(line.pickUp ?? null);
                        setLine(null);
                      },
                    },
                  }
                : {})}
            />
          ) : (
            <CompanionBubble
              key={resume?.conversationId ?? 'bubble'}
              petId={petId}
              petName={petName}
              greeting={greeting}
              expanded={mode === 'chat'}
              onDismiss={dismissGreeting}
              onOpenChat={() => setMode('chat')}
              onCollapse={() => setMode('bubble')}
              onClose={() => {
                mouth.stop();
                cancelTalk();
                void window.tagalongHost.hidePanel();
              }}
              tail={side === 'left' ? 'right' : 'left'}
              onSay={(said) => mouth.say(said)}
              mouth={mouth}
              talk={talk}
              seeing={{ on: seeing, onToggle: () => void window.tagalongHost.toggleSightPause() }}
              speaking={speaking}
              onStopSpeaking={() => {
                hush();
                mouth.stop();
              }}
              {...(snapshot !== null ? { snapshot } : {})}
              {...(resume !== null ? { resume } : {})}
              {...(pickUp !== null ? { pickUp, onPickUpDone: () => setPickUp(null) } : {})}
              {...(drop !== null ? { drop } : {})}
              onDropDone={() => setDrop(null)}
              status={status}
            />
          )}
        </div>
      </div>
    </HostBridgeProvider>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  installVoiceSeam();
  createRoot(container).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
