/**
 * The panel window's page: Scout's bubble beside the pet and the full chat one click behind
 * it, with talk-to-Scout (talk.ts), Scout's voice (the brain's speech, played here), the health check (health-facts.ts) and the
 * cards Scout opens (Scout's own wake lines and dropped items).
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApprovedReport, CompanionBubble, GreetingLine, HostBridgeProvider } from '@tagalong/ui';
import type { ContextSnapshot, PetRemarkParams, StatusMark } from '@tagalong/ui/shapes';
import type { DropOffer } from '@tagalong/ui';
// Bundled, not fetched: the bubble's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './app.css';
import '../../shared/ipc';
import { SpeechPlayer } from './voice-player';
import { DEFAULT_TALK_KEY, panelSettings } from './panel-settings';
import type { PanelSettings } from './panel-settings';
import { useTalk } from './talk';
import { installVoiceSeam } from './voice-seam';
import { fullBridge } from './full-bridge';

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
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'bubble' | 'chat'>('bubble');
  // A line Scout says on its own (a wake).
  const [remark, setRemark] = useState<PetRemarkParams | null>(null);
  // Something dropped on Scout: its card, until a button on it is pressed.
  const [drop, setDrop] = useState<DropOffer | null>(null);
  // Which side of the pet this window sits on; the speech tail points the other way, at it.
  const [side, setSide] = useState<'left' | 'right'>('left');
  const root = useRef<HTMLDivElement>(null);
  // Scout talks: one line at a time; main decides who says it, or that it stays quiet.
  const [speaking, setSpeaking] = useState(false);
  // A spoken answer still streaming in: the follow-up window waits for the end of all of it.
  const [answering, setAnswering] = useState(false);
  // The voice settings the player reads when a sentence arrives, so a save applies at once.
  const mouthRef = useRef<PanelSettings['mouth']>('kokoro');
  const speedRef = useRef(1);
  // The brain speaks; this plays its sentences in order and cuts them off on Stop.
  const [player] = useState(
    () =>
      new SpeechPlayer({
        mouth: () => mouthRef.current,
        rate: () => speedRef.current,
        hush: () => void window.tagalongHost.hush(),
        onState: ({ speaking: now, answering: streaming }) => {
          setSpeaking(now);
          setAnswering(streaming);
        },
      }),
  );
  // Talk to Scout: the talk key held, or the mic button. Talking cuts Scout off at once.
  const [talkKey, setTalkKey] = useState(DEFAULT_TALK_KEY);
  const [microphoneId, setMicrophoneId] = useState<string | undefined>(undefined);
  // Seeing: off is sight paused, the same switch as the pause key and the tray.
  const [seeing, setSeeing] = useState(true);
  const [bridge] = useState(fullBridge);
  // The top status mark: a muted row in the bubble, the same mark as the tag on Scout.
  const [status, setStatus] = useState<StatusMark | null>(null);
  function apply(next: PanelSettings): void {
    setTalkKey(next.talkKey);
    setMicrophoneId(next.microphoneId);
    mouthRef.current = next.mouth;
    speedRef.current = next.speed;
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
      player.stop();
      setRemark(null);
    },
  });

  useEffect(() => {
    void window.tagalongHost.getSightPaused().then((paused) => setSeeing(!paused));
    return window.tagalongHost.onSightPause((paused) => setSeeing(!paused));
  }, []);

  // The stop key cuts Scout off mid-sentence.
  useEffect(
    () =>
      window.tagalongHost.onStopVoice(() => {
        hush();
        player.stop();
      }),
    [player, hush],
  );
  // What the brain says arrives a sentence at a time, then a mark that the turn is done.
  useEffect(() => {
    const offChunk = window.tagalongHost.onSpeechChunk((chunk) => player.enqueue(chunk));
    const offDone = window.tagalongHost.onSpeechDone((turn) => player.done(turn));
    return () => {
      offChunk();
      offDone();
    };
  }, [player]);
  // Transparent around the bubble's rounded corners; the window itself is transparent.
  useEffect(() => {
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => window.tagalongHost.onPanelSide(setSide), []);

  useEffect(() => {
    void window.tagalongHost
      .getStatusMark()
      .then(setStatus)
      .catch(() => undefined);
    return window.tagalongHost.onStatusMark(setStatus);
  }, []);

  useEffect(
    () =>
      window.tagalongHost.onRemark((next) => {
        setMode('bubble');
        setRemark(next);
      }),
    [],
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

  useEffect(() => {
    void window.tagalongHost.getContext().then(setSnapshot);
    // A hotkey press means a question: it ends a quiet line and brings back the bubble.
    return window.tagalongHost.onContext((next) => {
      setSnapshot(next);
      setRemark(null);
      setDrop(null);
    });
  }, []);

  // A drop on the figure: main opened the bubble and hands over the card for it.
  useEffect(
    () =>
      window.tagalongHost.onDrop((offer) => {
        setMode('bubble');
        setRemark(null);
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
          {remark !== null ? (
            <GreetingLine
              petName={petName}
              text={remark.text}
              tail={side === 'left' ? 'right' : 'left'}
              holdMs={12_000}
              onDone={() => {
                setRemark(null);
                player.stop();
                void window.tagalongHost.hidePanel();
              }}
              onOpen={() => setRemark(null)}
            />
          ) : (
            <CompanionBubble
              petId={petId}
              petName={petName}
              expanded={mode === 'chat'}
              onOpenChat={() => setMode('chat')}
              onCollapse={() => setMode('bubble')}
              onClose={() => {
                player.stop();
                cancelTalk();
                void window.tagalongHost.hidePanel();
              }}
              tail={side === 'left' ? 'right' : 'left'}
              talk={talk}
              seeing={{ on: seeing, onToggle: () => void window.tagalongHost.toggleSightPause() }}
              speaking={speaking}
              onStopSpeaking={() => {
                hush();
                player.stop();
              }}
              {...(snapshot !== null ? { snapshot } : {})}
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
