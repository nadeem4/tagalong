import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CompanionBubble,
  GreetingLine,
  HostBridgeProvider,
  QueueMouth,
  SpeechQueue,
} from '@tagalong/ui';
import type { ContextSnapshot, PetRemarkParams, RoutineResultParams } from '@tagalong/protocol';
// Bundled, not fetched: the bubble's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './app.css';
import '../../shared/ipc';
import type { GreetLine } from '../../shared/ipc';
import { prepareLine } from './voice-player';
import { DEFAULT_TALK_KEY, panelSettings, readable } from './panel-settings';
import type { PanelSettings } from './panel-settings';
import { useTalk } from './talk';
import { installVoiceSeam } from './voice-seam';

/** The full chat's height; the bubble measures its own. Matches main's PANEL_HEIGHT. */
const CHAT_HEIGHT = 520;

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
  const [hotkeyLabel, setHotkeyLabel] = useState('Ctrl+Shift+Space');
  const [userName, setUserName] = useState('');
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'bubble' | 'chat'>('bubble');
  const [greeting, setGreeting] = useState(false);
  const [line, setLine] = useState<GreetLine | null>(null);
  // A line Scout says on its own, from keeping an eye on things, with Not now on it.
  const [remark, setRemark] = useState<PetRemarkParams | null>(null);
  // A routine's result: a quiet line that opens to the full answer in its conversation.
  const [routine, setRoutine] = useState<RoutineResultParams | null>(null);
  const [resume, setResume] = useState<{
    conversationId: string;
    question: string;
    answer: string;
  } | null>(null);
  // Which side of the pet this window sits on; the speech tail points the other way, at it.
  const [side, setSide] = useState<'left' | 'right'>('left');
  const root = useRef<HTMLDivElement>(null);
  // Scout talks: one line at a time; main decides who says it, or that it stays quiet.
  const [speaking, setSpeaking] = useState(false);
  const [mouth] = useState(
    () =>
      new QueueMouth(
        new SpeechQueue({ prepare: (text) => prepareLine(text), onSpeaking: setSpeaking }),
      ),
  );
  // Talk to Scout: the talk key held, or the mic button. Talking cuts Scout off at once.
  const [talkKey, setTalkKey] = useState(readable(DEFAULT_TALK_KEY, 'win32'));
  const [microphoneId, setMicrophoneId] = useState<string | undefined>(undefined);
  const platform = useRef('win32');
  // Seeing: off is sight paused, the same switch as the pause key and the tray.
  const [seeing, setSeeing] = useState(true);
  function apply(next: PanelSettings): void {
    setHotkeyLabel(next.hotkeyLabel);
    setTalkKey(next.talkKey);
    setMicrophoneId(next.microphoneId);
    setUserName(next.userName);
  }
  const { talk, cancel: cancelTalk } = useTalk({
    keyLabel: talkKey,
    microphoneId,
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

  // The stop key cuts Scout off mid-sentence, and a watch that fires is said aloud.
  useEffect(() => window.tagalongHost.onStopVoice(() => mouth.stop()), [mouth]);
  useEffect(
    () =>
      window.tagalong.onTurnEvent((event) => {
        if (event.type === 'watch.fired') mouth.say(event.message);
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
        // Welcome has just saved the name, if one was typed: read it before the hello starts.
        void window.tagalongHost
          .getHostView()
          .then((view) => setUserName(view.settings.userName))
          .catch(() => undefined)
          .finally(() => setGreeting(true));
      }),
    [],
  );

  // A later launch: one quiet line, which fades and hides the window unless touched.
  useEffect(
    () =>
      window.tagalongHost.onGreetLine((next) => {
        setMode('bubble');
        setLine(next);
        mouth.say(next.text);
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
    });
  }, []);

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

  // Opens on the default pet (Scout on a fresh install); the crew strip moves it from there.
  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([pets, view]) => {
        const preferred = pets.find((pet) => pet.id === view.settings.defaultPetId) ?? pets[0];
        setPetId(preferred?.id ?? null);
        if (preferred !== undefined) setPetName(preferred.name);
        platform.current = view.platform;
        apply(panelSettings(view.settings, view.platform));
      })
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

  // A save in Settings or Home reaches an open panel at once: keys, microphone, name.
  useEffect(
    () =>
      window.tagalongHost.onSettingsChanged((settings) =>
        apply(panelSettings(settings, platform.current)),
      ),
    [],
  );

  // A click on the desktop crew strip picks the pet this panel talks to.
  useEffect(() => window.tagalongHost.onActivePet(setPetId), []);

  if (petId === null) return <p className="settings__note">Waking the crew…</p>;

  return (
    <HostBridgeProvider bridge={window.tagalong}>
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
          ) : line !== null ? (
            <GreetingLine
              petName={petName}
              text={line.text}
              tail={side === 'left' ? 'right' : 'left'}
              onDone={() => {
                setLine(null);
                mouth.stop();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => setLine(null)}
              {...(line.fix !== undefined
                ? {
                    offer: {
                      label: line.fix,
                      onAccept: () => {
                        setLine(null);
                        mouth.stop();
                        void window.tagalongHost.openSettings();
                        void window.tagalongHost.hidePanel();
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
              hotkeyLabel={hotkeyLabel}
              userName={userName}
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
              onStopSpeaking={() => mouth.stop()}
              {...(snapshot !== null ? { snapshot } : {})}
              {...(resume !== null ? { resume } : {})}
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
