import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionBubble, GreetingLine, HostBridgeProvider, SpeechQueue } from '@tagalong/ui';
import type { ContextSnapshot, PetRemarkParams } from '@tagalong/protocol';
import './app.css';
import '../../shared/ipc';
import { playLine } from './voice-player';

/** The full chat's height; the bubble measures its own. Matches main's PANEL_HEIGHT. */
const CHAT_HEIGHT = 520;

/** The ask key as a person reads it on this platform. */
function readable(accelerator: string, platform: string): string {
  return accelerator.replace('CommandOrControl', platform === 'darwin' ? 'Cmd' : 'Ctrl');
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
  const [hotkeyLabel, setHotkeyLabel] = useState('Ctrl+Shift+Space');
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'bubble' | 'chat'>('bubble');
  const [greeting, setGreeting] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  // A line Scout says on its own, from keeping an eye on things, with Not now on it.
  const [remark, setRemark] = useState<PetRemarkParams | null>(null);
  // Which side of the pet this window sits on; the speech tail points the other way, at it.
  const [side, setSide] = useState<'left' | 'right'>('left');
  const root = useRef<HTMLDivElement>(null);
  // Scout talks: one line at a time; main decides who says it, or that it stays quiet.
  const [speaking, setSpeaking] = useState(false);
  const [voice] = useState(() => new SpeechQueue({ play: playLine, onSpeaking: setSpeaking }));

  // The stop key cuts Scout off mid-sentence, and a watch that fires is said aloud.
  useEffect(() => window.tagalongHost.onStopVoice(() => voice.stop()), [voice]);
  useEffect(
    () =>
      window.tagalong.onTurnEvent((event) => {
        if (event.type === 'watch.fired') voice.say(event.message);
      }),
    [voice],
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
        setGreeting(true);
      }),
    [],
  );

  // A later launch: one quiet line, which fades and hides the window unless touched.
  useEffect(
    () =>
      window.tagalongHost.onGreetLine((text) => {
        setMode('bubble');
        setLine(text);
        voice.say(text);
      }),
    [voice],
  );

  useEffect(
    () =>
      window.tagalongHost.onRemark((next) => {
        setMode('bubble');
        setLine(null);
        setRemark(next);
        voice.say(next.text);
      }),
    [voice],
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
    voice.stop();
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
        setHotkeyLabel(readable(view.settings.hotkeys.ask, view.platform));
      })
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

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
          {remark !== null ? (
            <GreetingLine
              petName={petName}
              text={remark.text}
              tail={side === 'left' ? 'right' : 'left'}
              holdMs={12_000}
              onDone={() => {
                setRemark(null);
                voice.stop();
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
              text={line}
              tail={side === 'left' ? 'right' : 'left'}
              onDone={() => {
                setLine(null);
                voice.stop();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => setLine(null)}
            />
          ) : (
            <CompanionBubble
              petId={petId}
              petName={petName}
              greeting={greeting}
              hotkeyLabel={hotkeyLabel}
              expanded={mode === 'chat'}
              onDismiss={dismissGreeting}
              onOpenChat={() => setMode('chat')}
              onCollapse={() => setMode('bubble')}
              onClose={() => {
                voice.stop();
                void window.tagalongHost.hidePanel();
              }}
              tail={side === 'left' ? 'right' : 'left'}
              onSay={(said) => voice.say(said)}
              speaking={speaking}
              onStopSpeaking={() => voice.stop()}
              {...(snapshot !== null ? { snapshot } : {})}
            />
          )}
        </div>
      </div>
    </HostBridgeProvider>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
