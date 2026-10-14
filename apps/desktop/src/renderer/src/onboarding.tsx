import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings, WelcomeStep } from '@tagalong/protocol';
import { PixelSprite, SpeechQueue, characterFor } from '@tagalong/ui';
// Bundled, not fetched: setup's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './app.css';
import './welcome.css';
import { answerPatch, answered, chipState, goTo, startFirstRun } from './first-run';
import type { FirstRun, FirstRunAnswer } from './first-run';
import { choicesFor, matchChoice, nameFrom } from './first-run-match';
import {
  STEP_NAMES,
  chipLabel,
  echoFor,
  notCaught,
  optionsFor,
  readableKey,
  scoutSays,
} from './first-run-lines';
import type { LineContext } from './first-run-lines';
import { prepareLine } from './voice-player';
import { installVoiceSeam } from './voice-seam';
import type { ClaudeSignIn, HostView } from '../../shared/ipc';

const CLAUDE_INSTALL = 'https://claude.com/claude-code';
/** While Claude Code is signed out, Scout checks this often and moves on once it is in. */
const SIGN_IN_POLL_MS = 3_000;
/** Said when the key test itself could not run; the key is never in it. */
const KEY_TEST_FAILED = 'I couldn’t test that key just now. Try again.';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Setup, driven by Scout: it asks each question aloud and in its bubble, suggests an answer
 * when it can, and moves on by itself once you answer by typing or a tap. No Next button;
 * the step chips are the way back. Every answer is saved as it is given, so closing the
 * window resumes at the same step next launch.
 */
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
  // Setup's lines are spoken the way the bubble's are: got ready one ahead, one at a time.
  const [voice] = useState(() => new SpeechQueue({ prepare: (text) => prepareLine(text) }));
  const finishing = useRef(false);

  useEffect(() => {
    Promise.all([window.tagalongHost.getHostView(), window.tagalongHost.checkClaudeSignIn()])
      .then(([loaded, state]) => {
        setView(loaded);
        setSettings(loaded.settings);
        setSignIn(state);
        // Milestone 2 answers by typing or a tap; listening joins in Milestone 3.
        setRun(startFirstRun(loaded.settings, false));
      })
      .catch((error: unknown) => setProblem(`Tagalong could not start setup: ${String(error)}`));
  }, []);

  // Signed out: Scout waits, checking now and then, and suggests Claude once it is in.
  const current = run?.current;
  useEffect(() => {
    if (current !== 'think' || signIn !== 'signed-out') return;
    const timer = setInterval(() => {
      void window.tagalongHost
        .checkClaudeSignIn()
        .then(setSignIn)
        .catch(() => undefined);
    }, SIGN_IN_POLL_MS);
    return () => clearInterval(timer);
  }, [current, signIn]);

  const providers = view?.providers ?? [];
  const scout = view?.pets.find((pet) => pet.id === view.settings.defaultPetId);
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

  // Each line Scout says is also spoken, while Scout talks.
  const speaks = settings?.voice.enabled === true;
  useEffect(() => {
    if (line === '' || !speaks) return;
    voice.stop();
    voice.say(line);
  }, [line, speaks, voice]);
  useEffect(() => () => voice.stop(), [voice]);

  async function finish(saved: Settings): Promise<void> {
    if (finishing.current) return;
    finishing.current = true;
    voice.stop();
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
      const saved = await window.tagalongHost.saveSettings(answerPatch(answer, settings, after));
      setSettings(saved);
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

  /** The one way an answer comes in: typed text now, heard speech too in Milestone 3. */
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

  /** Saves the pasted key, if any, and tests it once. Only a passing test moves setup on. */
  async function testKey(): Promise<void> {
    if (keyFor === null) return;
    const pasted = key.trim();
    const stored = providers.find((provider) => provider.id === keyFor)?.hasKey === true;
    if (pasted === '' && !stored) return;
    setBusy(true);
    setProblem(null);
    try {
      if (pasted !== '') await window.tagalongHost.saveApiKey(keyFor, pasted);
      setKey('');
    } catch (error) {
      setProblem(messageOf(error));
      setBusy(false);
      return;
    }
    let passed = false;
    try {
      const result = await window.tagalongHost.checkKey(keyFor);
      if (result.ok) passed = true;
      else {
        setProblem(result.message);
        setAside(result.message);
      }
    } catch {
      // The test itself could not run: say so plainly, and stay on this step.
      setProblem(KEY_TEST_FAILED);
      setAside(KEY_TEST_FAILED);
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
      </header>
      <div className="first-run__body">
        <aside className="first-run__scout" aria-label={context.petName}>
          {echo !== null && <p className="first-run__echo">{echo}</p>}
          <p className="first-run__says" role="status" aria-live="polite">
            {line}
          </p>
          {scout !== undefined && (
            <PixelSprite
              className="first-run__sprite"
              sprite={characterFor(scout).sprite}
              scale={6}
            />
          )}
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
          <div className="first-run__grow" />
          {keyFor === null && run.current !== 'try' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = typed;
                setTyped('');
                heard(text);
              }}
            >
              <label className="first-run__answer">
                <span className="first-run__hidden">Answer {context.petName}</span>
                <input
                  type="text"
                  placeholder={run.current === 'name' ? 'Type your name' : 'Or type your answer'}
                  value={typed}
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </label>
            </form>
          )}
          <p className="first-run__hint">
            Answer by typing or a tap and I move on. Tap a step above to change it.
          </p>
        </section>
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  // Voice reaches this window the way it reaches the bubble; Milestone 3 switches listening on.
  installVoiceSeam();
  createRoot(container).render(
    <StrictMode>
      <FirstRunWindow />
    </StrictMode>,
  );
}
