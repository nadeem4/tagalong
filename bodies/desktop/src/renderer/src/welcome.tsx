/**
 * The Welcome window's page (built as `welcome.html`): Scout asks each setup question
 * aloud and in its bubble, suggests an answer when it can, and setup moves on once you answer
 * by voice, typing or a tap. Every answer is saved as given, so a closed window resumes at the
 * same step next launch. The step rules are in first-run.ts, the matching in
 * first-run-match.ts, the wording in first-run-lines.ts.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings, SettingsPatch, WelcomeStep } from '@tagalong/protocol';
import { BeanClip, SpeechQueue } from '@tagalong/ui';
// Bundled, not fetched: setup's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './app.css';
import './welcome.css';
import { FIGURE } from './bean-assets';
import {
  answerPatch,
  answered,
  chipState,
  goTo,
  listensNow,
  oneAtATime,
  startFirstRun,
} from './first-run';
import type { FirstRun, FirstRunAnswer } from './first-run';
import { choicesFor, matchChoice, nameFrom } from './first-run-match';
import {
  KEY_LINES,
  LISTENING_HINT,
  STEP_NAMES,
  chipLabel,
  echoFor,
  listenFailed,
  listeningHint,
  notCaught,
  optionsFor,
  readableKey,
  scoutSays,
} from './first-run-lines';
import type { LineContext } from './first-run-lines';
import { RemoteEars } from './remote-ears';
import { setupEars } from './setup-ears';
import type { SetupEars, SetupListening } from './setup-ears';
import { onSystemVoice, prepareLine } from './voice-player';
import { installVoiceSeam } from './voice-seam';
import type { ClaudeSignIn, HostView } from '../../shared/ipc';

const CLAUDE_INSTALL = 'https://claude.com/claude-code';
/** While Claude Code is signed out, Scout checks this often and moves on once it is in. */
const SIGN_IN_POLL_MS = 3_000;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Welcome. No Next button: the step chips are the way back. It listens only after "Talk to me". */
function FirstRunWindow() {
  const [view, setView] = useState<HostView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [run, setRun] = useState<FirstRun | null>(null);
  const [signIn, setSignIn] = useState<ClaudeSignIn | null>(null);
  const [picking, setPicking] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [typed, setTyped] = useState('');
  const [echo, setEcho] = useState<string | null>(null);
  const [aside, setAside] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 'off'; a fraction while the speech model downloads; null while the mic is open.
  const [listening, setListening] = useState<SetupListening>('off');
  // Listening failed in this window: it stays off until "Talk to me" is chosen again.
  const [earsFailed, setEarsFailed] = useState(false);
  // Always listening, as main holds it (null until known): switched here, saved by main.
  const [always, setAlways] = useState<boolean | null>(null);
  // Setup's saves run one at a time, so a failure's save and an answer's never overwrite each other.
  const [saves] = useState(oneAtATime);
  // Keys saved in this window: a key that failed its test is still stored, so Check key retests it.
  const [savedKeys, setSavedKeys] = useState<readonly string[]>([]);
  const answerInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  // Setup's lines are spoken the way the bubble's are: got ready one ahead, one at a time.
  // The voice step's line is the sample of how Scout sounds: an empty preview has main speak it
  // even while voice is off.
  const stepNow = useRef<WelcomeStep | undefined>(undefined);
  const [voice] = useState(
    () =>
      new SpeechQueue({
        prepare: (text) =>
          stepNow.current === 'voice' ? prepareLine(text, {}) : prepareLine(text),
      }),
  );
  const finishing = useRef(false);

  useEffect(() => {
    Promise.all([window.tagalongHost.getHostView(), window.tagalongHost.checkClaudeSignIn()])
      .then(([loaded, state]) => {
        setView(loaded);
        setSettings(loaded.settings);
        setSignIn(state);
        setRun(startFirstRun(loaded.settings));
      })
      .catch((error: unknown) => setProblem(`Tagalong could not start setup: ${String(error)}`));
  }, []);

  // Signed out: Scout waits, checking now and then, and suggests Claude once it is in.
  const current = run?.current;
  stepNow.current = current;
  useEffect(() => {
    if (current !== 'think' || signIn !== 'signed-out') return;
    // Each check starts the next wait only once it has finished, so checks never overlap.
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = (): void => {
      void window.tagalongHost
        .checkClaudeSignIn()
        .then((state) => {
          if (!stopped) setSignIn(state);
        })
        .catch(() => undefined)
        .then(() => {
          if (!stopped) timer = setTimeout(poll, SIGN_IN_POLL_MS);
        });
    };
    timer = setTimeout(poll, SIGN_IN_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [current, signIn]);

  // A sign-in that lands while the services are listed brings Claude's suggestion back.
  useEffect(() => {
    if (signIn === 'signed-in' && keyFor === null) setPicking(false);
  }, [signIn]);

  // Focus follows the question: the key field when it is open, otherwise the answer pill.
  useEffect(() => {
    if (busy) return;
    (keyFor !== null ? keyInput : answerInput).current?.focus();
  }, [current, picking, keyFor, busy]);

  useEffect(() => {
    void window.tagalongHost
      .getListening()
      .then((state) => setAlways(state.on))
      .catch(() => undefined);
    return window.tagalongHost.onListening((state) => setAlways(state.on));
  }, []);

  // What the ears' callbacks reach: always the latest, as the ears are made once.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const heardRef = useRef<(text: string) => void>(() => undefined);

  /** Every save of setup's settings: one at a time, each patch built from the latest settings. */
  function save(patchFor: (now: Settings) => SettingsPatch): Promise<Settings> {
    return saves(async () => {
      const now = settingsRef.current;
      if (now === null) throw new Error('Setup has not loaded yet.');
      const saved = await window.tagalongHost.saveSettings(patchFor(now));
      settingsRef.current = saved;
      setSettings(saved);
      return saved;
    });
  }

  // Setup's ears, made once. Unmounting or the page going away disposes them, closing the mic.
  const ears = useRef<SetupEars | null>(null);
  useEffect(() => {
    const made = setupEars({
      ears: (mode) => new RemoteEars(window.tagalongHost, mode),
      openMic: () => window.tagalongVoice.openMic(settingsRef.current?.voice.microphoneId),
      ensureEars: (onProgress) => window.tagalongVoice.ensureEars(onProgress),
      onEarsStatus: (handler) => window.tagalongHost.onEarsStatus(handler),
      onSystemVoice,
      onHeard: (text) => {
        if (!busyRef.current) heardRef.current(text);
      },
      onSpeechStart: () => voice.stop(),
      onState: setListening,
      onFailure: (why) => {
        setEarsFailed(true);
        setAside(listenFailed(why));
        void typeInstead();
      },
    });
    ears.current = made;
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      made.dispose();
    };
    // React runs no cleanup when the window closes; pagehide does.
    window.addEventListener('pagehide', dispose);
    return () => {
      window.removeEventListener('pagehide', dispose);
      dispose();
    };
  }, []);

  // Listening follows what was saved, and this is the only place it starts or stops: "Talk
  // to me", "I'll type", a resume, the chips and Try it all come through here.
  const wants = !earsFailed && run !== null && settings !== null && listensNow(run, settings);
  useEffect(() => {
    if (wants) ears.current?.start();
    else ears.current?.stop();
  }, [wants]);

  /** Listening failed: answers are typed from here, and the Answer chip says so. */
  async function typeInstead(): Promise<void> {
    try {
      await save((now) => ({ welcome: { ...now.welcome, answerBy: 'type' } }));
    } catch (error) {
      setProblem(messageOf(error));
    }
  }

  const providers = view?.providers ?? [];
  const scout = view?.pets[0];
  const context: LineContext | null =
    run === null || settings === null
      ? null
      : {
          petName: scout?.name ?? 'Scout',
          first: run.steps[0] === run.current,
          signIn,
          picking,
          keyLabel: providers.find((provider) => provider.id === keyFor)?.label ?? null,
          askKey: readableKey(settings.hotkeys.ask || SETTINGS_DEFAULTS.hotkeys.ask),
        };
  const says = run !== null && context !== null ? scoutSays(run.current, context) : null;
  const line = aside ?? says?.line ?? '';

  // Each line Scout says is also spoken, while Scout talks. The voice step's line is the
  // sample of how Scout sounds, so it is spoken either way.
  const speaks = settings?.voice.enabled === true || current === 'voice';
  useEffect(() => {
    if (line === '' || !speaks) return;
    voice.stop();
    voice.say(line);
  }, [line, speaks, voice]);
  useEffect(() => () => voice.stop(), [voice]);

  async function finish(saved: Settings): Promise<void> {
    if (finishing.current) return;
    finishing.current = true;
    setProblem(null);
    voice.stop();
    // The mic closes before the window does.
    ears.current?.stop();
    try {
      await window.tagalongHost.finishWelcome(saved.welcome.brain ?? 'claude-code');
    } catch (error) {
      finishing.current = false;
      setProblem(messageOf(error));
    }
  }

  // Reaching Try it finishes setup: Scout goes to its corner for the first real question.
  useEffect(() => {
    if (current === 'try' && settings !== null) void finish(settings);
  }, [current]);

  async function give(answer: FirstRunAnswer): Promise<void> {
    if (run === null || settings === null) return;
    const declined = answer.step === 'name' ? answer.name === '' : settings.userNameDeclined;
    const after = answered(run, declined);
    setBusy(true);
    try {
      await save((now) => answerPatch(answer, now, after));
      // "Talk to me" chosen again is the retry after a failure.
      if (answer.step === 'answer' && answer.by === 'talk') setEarsFailed(false);
      setEcho(echoFor(answer, providers));
      setAside(null);
      setProblem(null);
      setPicking(false);
      setKeyFor(null);
      setRun(after);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  function checkSignIn(): void {
    void window.tagalongHost
      .checkClaudeSignIn()
      .then(setSignIn)
      .catch((error: unknown) => setProblem(messageOf(error)));
  }

  function pick(id: string): void {
    if (run === null) return;
    setAside(null);
    switch (run.current) {
      case 'answer':
        return void give({ step: 'answer', by: id === 'talk' ? 'talk' : 'type' });
      case 'name':
        return void give({ step: 'name', name: '' });
      case 'voice':
        return void give({ step: 'voice', talk: id === 'talk' });
      case 'keys':
        return void give({ step: 'keys' });
      case 'think':
        if (id === 'claude-code') return void give({ step: 'think', brain: 'claude-code' });
        if (id === 'key') return setPicking(true);
        if (id === 'back') {
          setPicking(false);
          setKeyFor(null);
          return setKey('');
        }
        if (id === 'sign-in') {
          return void window.tagalongHost
            .openClaudeSignIn()
            .catch((error: unknown) => setProblem(messageOf(error)));
        }
        if (id === 'install') return void window.tagalongHost.openLink(CLAUDE_INSTALL);
        if (id === 'check') return checkSignIn();
        setKey('');
        return setKeyFor(id);
      default:
        return;
    }
  }

  /** The one way an answer comes in: typed, or heard once "Talk to me" was chosen. */
  function heard(text: string): void {
    if (run === null || context === null) return;
    if (run.current === 'name') {
      const name = nameFrom(text);
      if (name === null) return setAside(notCaught('name', context));
      return void give({ step: 'name', name: name === 'declined' ? '' : name.name });
    }
    const id = matchChoice(text, choicesFor(run.current, signIn, picking, providers));
    if (id === null) return setAside(notCaught(run.current, context));
    pick(id);
  }
  heardRef.current = heard;

  /** Saves the pasted key, if any, and tests it once. Only a passing test moves setup on. */
  async function testKey(): Promise<void> {
    if (keyFor === null) return;
    const pasted = key.trim();
    const stored =
      savedKeys.includes(keyFor) ||
      providers.find((provider) => provider.id === keyFor)?.hasKey === true;
    if (pasted === '' && !stored) return setAside(KEY_LINES.empty);
    setBusy(true);
    setProblem(null);
    setAside(null);
    try {
      if (pasted !== '') {
        await window.tagalongHost.saveApiKey(keyFor, pasted);
        setSavedKeys((saved) => [...saved, keyFor]);
      }
      setKey('');
    } catch (error) {
      setProblem(messageOf(error));
      setBusy(false);
      return;
    }
    let passed = false;
    try {
      const result = await window.tagalongHost.checkKey(keyFor);
      // What went wrong with the key is Scout's to say, once, in its bubble; the alert
      // below is for the window itself failing (a save, a sign-in, finishing).
      if (result.ok) passed = true;
      else setAside(result.message);
    } catch {
      // The test itself could not run: say so plainly, and stay on this step.
      setAside(KEY_LINES.untested);
    }
    setBusy(false);
    if (passed) await give({ step: 'think', brain: keyFor });
  }

  if (run === null || settings === null || context === null || says === null) {
    return (
      <main className="first-run">
        <p className="first-run__loading" role="status">
          {problem ?? 'Looking around this computer…'}
        </p>
      </main>
    );
  }

  const chip = (step: WelcomeStep) => {
    const state = chipState(run, step);
    if (state === 'done') {
      return (
        <button
          key={step}
          type="button"
          className="first-run__chip is-done"
          aria-label={`${STEP_NAMES[step]}: ${chipLabel(step, settings, providers)}. Change it`}
          disabled={busy}
          onClick={() => {
            setRun(goTo(run, step));
            setAside(null);
            setEcho(null);
            setProblem(null);
            setPicking(false);
            setKeyFor(null);
          }}
        >
          {chipLabel(step, settings, providers)}
        </button>
      );
    }
    return (
      <span
        key={step}
        className={state === 'current' ? 'first-run__chip is-current' : 'first-run__chip'}
        {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
      >
        {STEP_NAMES[step]}
      </span>
    );
  };

  return (
    <main className="first-run">
      <header className="first-run__top">
        <nav className="first-run__steps" aria-label="Setup steps">
          {run.steps.map(chip)}
        </nav>
        {listening !== 'off' && (
          <p className="first-run__listening" role="status">
            {listening === null && <span className="first-run__dot" aria-hidden="true" />}
            {listeningHint(listening)}
          </p>
        )}
      </header>
      <div className="first-run__body">
        <aside className="first-run__scout" aria-label={context.petName}>
          {echo !== null && <p className="first-run__echo">{echo}</p>}
          <p className="first-run__says" role="status" aria-live="polite">
            {line}
          </p>
          {scout !== undefined && <BeanClip clip={FIGURE.idle} still size={96} name="idle" />}
        </aside>
        <section className="first-run__step" aria-labelledby="step-title">
          <h1 id="step-title">{says.title}</h1>
          <div className="first-run__options">
            {optionsFor(run.current, context, providers).map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  option.suggested === true ? 'first-run__option is-suggested' : 'first-run__option'
                }
                {...(picking ? { 'aria-pressed': option.id === keyFor } : {})}
                disabled={busy}
                onClick={() => pick(option.id)}
              >
                <span className="first-run__label">{option.label}</span>
                {option.note !== undefined && (
                  <span className="first-run__note">{option.note}</span>
                )}
              </button>
            ))}
          </div>
          {run.current === 'keys' && (
            <p className="first-run__keys" aria-label={context.askKey}>
              {context.askKey.split('+').map((part) => (
                <kbd key={part}>{part}</kbd>
              ))}
            </p>
          )}
          {run.current === 'keys' && (
            <div className="first-run__setting">
              <div>
                <p id="always-listening" className="first-run__label">
                  Always listening
                </p>
                <p className="first-run__note">Off by default. I never switch it on myself.</p>
              </div>
              <button
                type="button"
                role="switch"
                className="first-run__switch"
                aria-checked={always === true}
                aria-labelledby="always-listening"
                disabled={always === null}
                onClick={() =>
                  void window.tagalongHost
                    .setListening(always !== true)
                    .then((state) => setAlways(state.on))
                    .catch((error: unknown) => setProblem(messageOf(error)))
                }
              >
                {always === null ? '…' : always ? 'On' : 'Off'}
              </button>
            </div>
          )}
          {run.current === 'think' && keyFor !== null && (
            <form
              className="first-run__key"
              onSubmit={(event) => {
                event.preventDefault();
                void testKey();
              }}
            >
              <label>
                <span>Your {context.keyLabel} key</span>
                <input
                  ref={keyInput}
                  type="password"
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <button type="submit" className="first-run__primary" disabled={busy}>
                {busy ? 'Testing…' : 'Check key'}
              </button>
            </form>
          )}
          {problem !== null && (
            <p className="first-run__error" role="alert">
              {problem}
            </p>
          )}
          {run.current === 'try' && problem !== null && (
            <button
              type="button"
              className="first-run__primary first-run__retry"
              autoFocus
              onClick={() => void finish(settings)}
            >
              Try again
            </button>
          )}
          <div className="first-run__grow" />
          {keyFor === null && run.current !== 'try' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                const text = typed;
                setTyped('');
                heard(text);
              }}
            >
              <label className="first-run__answer">
                <span className="first-run__hidden">Answer {context.petName}</span>
                <input
                  ref={answerInput}
                  type="text"
                  placeholder={run.current === 'name' ? 'Type your name' : 'Or type your answer'}
                  value={typed}
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={busy}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </label>
            </form>
          )}
          <p className="first-run__hint">
            {wants
              ? LISTENING_HINT
              : 'Answer by typing or a tap and I move on. Tap a step above to change it.'}
          </p>
        </section>
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  // Voice reaches this window the way it reaches the bubble.
  installVoiceSeam();
  createRoot(container).render(
    <StrictMode>
      <FirstRunWindow />
    </StrictMode>,
  );
}
