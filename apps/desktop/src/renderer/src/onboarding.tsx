import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import { PixelSprite, characterFor } from '@tagalong/ui';
// Bundled, not fetched: the heading uses the office's pixel face, Latin subset only.
import '@fontsource/pixelify-sans/latin-400.css';
import './app.css';
import './welcome.css';
import { brainOptions, canStart, defaultBrain } from './welcome-flow';
import type { BrainOption } from './welcome-flow';
import type { FoundAgent, HostView } from '../../shared/ipc';

/** Where each agent is installed from, for its "How to add" link. */
const INSTALL_LINKS: Readonly<Record<string, string>> = {
  'claude-code': 'https://claude.com/claude-code',
  'gemini-cli': 'https://github.com/google-gemini/gemini-cli',
  codex: 'https://github.com/openai/codex',
};

/**
 * Welcome: the first window a new install shows. Scout says what it does, lists the
 * coding agents found on this computer, picks how it thinks (a sign-in where one is
 * found, so nothing is typed), names the one key to remember, and starts. Everything here
 * can be changed later in Home and Settings; the tray opens Welcome again.
 */
function Welcome() {
  const [view, setView] = useState<HostView | null>(null);
  const [agents, setAgents] = useState<FoundAgent[] | null>(null);
  const [brain, setBrain] = useState<string | undefined>(undefined);
  const [key, setKey] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([window.tagalongHost.getHostView(), window.tagalongHost.findAgents()])
      .then(([loaded, found]) => {
        setView(loaded);
        setAgents(found);
        setBrain(defaultBrain(brainOptions(found, loaded.providers)));
      })
      .catch((error: unknown) => setProblem(`Tagalong could not start Welcome: ${String(error)}`));
  }, []);

  if (view === null || agents === null) {
    return (
      <main className="welcome">
        <p className="welcome__note">{problem ?? 'Looking around this computer…'}</p>
      </main>
    );
  }

  const options = brainOptions(agents, view.providers);
  const chosen = options.find((option) => option.id === brain);
  const scout = view.pets.find((pet) => pet.id === view.settings.defaultPetId);
  const askKey = view.settings.hotkeys.ask || SETTINGS_DEFAULTS.hotkeys.ask;

  const start = async (): Promise<void> => {
    if (brain === undefined) return;
    setBusy(true);
    setProblem(null);
    try {
      if (chosen?.needsKey === true) await window.tagalongHost.saveApiKey(brain, key.trim());
      await window.tagalongHost.finishWelcome(brain);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <main className="welcome">
      <header className="welcome__hello">
        <div className="welcome__tile">
          {scout !== undefined && <PixelSprite sprite={characterFor(scout).sprite} scale={4} />}
        </div>
        <div>
          <h1>Hi, I’m {scout?.name ?? 'Scout'}.</h1>
          <p>
            I sit on your screen and see what you’re working on. Ask me anything. I hand the work to
            the right agent and tell you what came back.
          </p>
        </div>
      </header>

      <section aria-labelledby="found">
        <h2 id="found">Found on this computer</h2>
        <ul className="welcome__list">
          {agents.map((agent) => (
            <li key={agent.id}>
              <span className={agent.found ? 'welcome__dot is-found' : 'welcome__dot'} />
              <span className="welcome__name">
                {agent.label}
                <small>
                  {agent.found
                    ? agent.canThink
                      ? 'Ready'
                      : 'Found. Hand-offs to it come soon.'
                    : 'Not installed'}
                </small>
              </span>
              {!agent.found && INSTALL_LINKS[agent.id] !== undefined && (
                <button
                  type="button"
                  className="welcome__link"
                  onClick={() => void window.tagalongHost.openLink(INSTALL_LINKS[agent.id]!)}
                >
                  How to add
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="think">
        <h2 id="think">How I think</h2>
        <BrainPicker options={options} brain={brain} onPick={setBrain} />
        {chosen?.needsKey === true && (
          <label className="welcome__key">
            <span>{chosen.label}</span>
            <input
              type="password"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
        )}
      </section>

      <section aria-labelledby="key">
        <h2 id="key">One key to remember</h2>
        <p className="welcome__keys">
          {askKey
            .replace('CommandOrControl', 'Ctrl')
            .split('+')
            .map((part) => (
              <kbd key={part}>{part}</kbd>
            ))}
          <span>Ask me about whatever is on your screen.</span>
        </p>
      </section>

      {problem !== null && (
        <p className="welcome__error" role="alert">
          {problem}
        </p>
      )}

      <footer className="welcome__footer">
        <button
          type="button"
          className="welcome__start"
          disabled={busy || brain === undefined || !canStart(options, brain, key)}
          onClick={() => void start()}
        >
          {busy ? 'Starting…' : 'Start'}
        </button>
        <p className="welcome__note">
          I only look at your screen when you press the key. Everything here can be changed later in
          Home.
        </p>
      </footer>
    </main>
  );
}

function BrainPicker({
  options,
  brain,
  onPick,
}: {
  options: readonly BrainOption[];
  brain: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <div className="welcome__list" role="radiogroup" aria-label="How Scout thinks">
      {options.map((option) => (
        <label key={option.id} className="welcome__choice">
          <input
            type="radio"
            name="brain"
            checked={brain === option.id}
            onChange={() => onPick(option.id)}
          />
          <span className="welcome__name">
            {option.label}
            <small>
              {option.needsKey
                ? 'Paste a key below'
                : option.id === 'claude-code'
                  ? 'No key needed'
                  : 'Key stored'}
            </small>
          </span>
        </label>
      ))}
    </div>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Welcome />
    </StrictMode>,
  );
}
