import { StrictMode, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_ROLLING_MEMORY_MINUTES, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import { DEFAULT_PET_COLOR } from '@tagalong/ui';
import './app.css';
import {
  ONBOARDING_STEPS,
  WIZARD_PROVIDERS,
  hotkeyLabel,
  initialCrewPicks,
  keyedProviders,
  providerStepProblem,
} from './onboarding-flow';
import type { CrewPick } from './onboarding-flow';
import type { HostView, ModelList } from '../../shared/ipc';

/**
 * The first-run setup wizard: what Tagalong is and what it promises about privacy, a
 * provider and its key, the crew's models, the hotkeys, rolling memory, and the Chrome
 * extension — ending on a first question. Every step can be skipped, and the whole wizard
 * reruns from Settings or the tray.
 *
 * Each step saves when it is left, not at the end, so closing the window halfway keeps
 * what was done. Keys go straight to the keychain and are never read back.
 */
function Onboarding() {
  const [view, setView] = useState<HostView | null>(null);
  const [step, setStep] = useState(0);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [mainProvider, setMainProvider] = useState<string>(WIZARD_PROVIDERS[0]!.id);
  const [picks, setPicks] = useState<Record<string, CrewPick>>({});
  const [models, setModels] = useState<Record<string, ModelList>>({});
  const [memory, setMemory] = useState<{ enabled: boolean; minutes: string }>({
    enabled: false,
    minutes: String(SETTINGS_DEFAULTS.rollingMemory.minutes),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.tagalongHost
      .getHostView()
      .then((loaded) => {
        setView(loaded);
        setMemory({
          enabled: loaded.settings.rollingMemory.enabled,
          minutes: String(loaded.settings.rollingMemory.minutes),
        });
        const stored = loaded.providers.find(
          (choice) => choice.hasKey && WIZARD_PROVIDERS.some((p) => p.id === choice.id),
        );
        if (stored !== undefined) setMainProvider(stored.id);
      })
      .catch((error: unknown) => setProblem(String(error)));
  }, []);

  if (view === null) {
    return <main className="onboarding">{problem ?? 'Loading…'}</main>;
  }

  const current = ONBOARDING_STEPS[step]!;
  const keyed = keyedProviders(view.providers, keys);

  /** Fetches a provider's model list once, after its key is stored. */
  const loadModels = (providerId: string): void => {
    if (models[providerId] !== undefined) return;
    window.tagalongHost
      .listModels(providerId)
      .then((list) => setModels((all) => ({ ...all, [providerId]: list })))
      .catch(() =>
        setModels((all) => ({ ...all, [providerId]: { models: [], source: 'fallback' } })),
      );
  };

  /** Saves what the step being left collected. Throws a sentence when it cannot. */
  async function leave(): Promise<void> {
    if (view === null) return;
    if (current.id === 'provider') {
      const missing = providerStepProblem(view.providers, keys);
      if (missing !== null) throw new Error(missing);
      const typed = Object.entries(keys).filter(([, value]) => value.trim().length > 0);
      for (const [providerId, value] of typed) {
        await window.tagalongHost.saveApiKey(providerId, value.trim());
      }
      const stored = new Set(typed.map(([providerId]) => providerId));
      setKeys({});
      setView({
        ...view,
        providers: view.providers.map((choice) =>
          stored.has(choice.id) ? { ...choice, hasKey: true } : choice,
        ),
      });
      const main = keyed.includes(mainProvider) ? mainProvider : keyed[0]!;
      setPicks(initialCrewPicks(view.pets, keyed, main, view.crewSuggestions));
      for (const providerId of keyed) loadModels(providerId);
    }
    if (current.id === 'crew' && view.pets.length > 0) {
      const pets = await window.tagalongHost.applyCrew(picks);
      setView({ ...view, pets });
    }
    if (current.id === 'memory') {
      const minutes = Number(memory.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ROLLING_MEMORY_MINUTES) {
        throw new Error(
          `Rolling memory keeps between 1 and ${MAX_ROLLING_MEMORY_MINUTES} minutes.`,
        );
      }
      const settings = await window.tagalongHost.saveSettings({
        rollingMemory: { enabled: memory.enabled, minutes },
      });
      setView({ ...view, settings });
    }
  }

  async function next(): Promise<void> {
    setBusy(true);
    try {
      await leave();
      setProblem(null);
      setStep((index) => Math.min(index + 1, ONBOARDING_STEPS.length - 1));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const finish = (openPanel: boolean): void => {
    void window.tagalongHost
      .finishOnboarding(openPanel)
      .catch((error: unknown) => setProblem(String(error)));
  };

  const hotkeys = view.settings.hotkeys;
  const key = (accelerator: string | undefined, fallback: string): string =>
    hotkeyLabel(accelerator ?? fallback, view.platform);

  const body: Record<string, ReactNode> = {
    welcome: (
      <>
        <p>
          Tagalong is a small crew of AI pets that sit on your desktop. Press a key and the pet you
          are talking to can read what you selected, look at your screen, or read the page you are
          on in Chrome — then answer in a panel beside it.
        </p>
        <h2>The privacy promise</h2>
        <ul>
          <li>Nothing is read until you press a hotkey or ask. Every look is announced.</li>
          <li>Screenshots are never written to disk unless you turn that on for debugging.</li>
          <li>Password managers and the Windows sign-in screens are never captured.</li>
          <li>
            Your API keys are encrypted with the operating system&apos;s keychain and only ever sent
            to the provider they belong to.
          </li>
          <li>
            What you ask goes to the AI provider you choose next, and nowhere else. There is no
            Tagalong server.
          </li>
          <li>One key pauses all sight, and the tray has the same switch.</li>
        </ul>
      </>
    ),
    provider: (
      <>
        <p>
          Pick the service your pets think with and paste its API key. You can add a second one now
          — the crew can mix providers — or later in Settings.
        </p>
        {WIZARD_PROVIDERS.map((provider) => {
          const stored = view.providers.find((choice) => choice.id === provider.id)?.hasKey;
          return (
            <fieldset
              key={provider.id}
              className={`onboarding__provider${mainProvider === provider.id ? ' is-main' : ''}`}
            >
              <label className="settings__check">
                <input
                  type="radio"
                  name="mainProvider"
                  checked={mainProvider === provider.id}
                  onChange={() => setMainProvider(provider.id)}
                />
                <strong>{provider.label}</strong>
              </label>
              <p className="settings__note">{provider.blurb}</p>
              <label>
                <span>
                  {provider.label} API key {stored === true ? '(stored — type to replace)' : ''}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  data-testid={`key-${provider.id}`}
                  value={keys[provider.id] ?? ''}
                  onChange={(event) => setKeys({ ...keys, [provider.id]: event.target.value })}
                />
              </label>
              <button
                type="button"
                onClick={() => void window.tagalongHost.openLink(provider.keyUrl)}
              >
                Get a {provider.label} key
              </button>
            </fieldset>
          );
        })}
      </>
    ),
    crew: (
      <>
        <p>
          Three pets start with you. Scout explains what is on screen, Ink writes, and Bolt reads
          errors and code. Give each one a model; the list comes live from the provider.
        </p>
        {view.pets.length === 0 && (
          <p className="settings__error">
            The engine is not running, so the crew cannot be changed here. Finish setup, restart
            Tagalong, and pick models in Settings.
          </p>
        )}
        {view.pets.map((pet) => {
          const pick = picks[pet.id] ?? { providerId: pet.providerId, model: pet.model };
          const list = models[pick.providerId];
          const listId = `crew-models-${pet.id}`;
          const label =
            WIZARD_PROVIDERS.find((provider) => provider.id === pick.providerId)?.label ??
            pick.providerId;
          return (
            <fieldset
              key={pet.id}
              className="settings__pet"
              style={{ borderColor: pet.color ?? DEFAULT_PET_COLOR }}
            >
              <legend>
                {pet.avatar} {pet.name}
              </legend>
              <label>
                <span>Provider</span>
                <select
                  value={pick.providerId}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    loadModels(providerId);
                    const suggested =
                      view.crewSuggestions[providerId]?.[pet.id] ??
                      view.crewSuggestions[providerId]?.scout ??
                      '';
                    setPicks({ ...picks, [pet.id]: { providerId, model: suggested } });
                  }}
                >
                  {keyed.map((providerId) => (
                    <option key={providerId} value={providerId}>
                      {WIZARD_PROVIDERS.find((provider) => provider.id === providerId)?.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model</span>
                <input
                  list={listId}
                  data-testid={`model-${pet.id}`}
                  value={pick.model}
                  onChange={(event) =>
                    setPicks({ ...picks, [pet.id]: { ...pick, model: event.target.value } })
                  }
                />
              </label>
              <datalist id={listId}>
                {(list?.models ?? []).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <p className="settings__note">
                {list === undefined
                  ? 'Loading models…'
                  : list.source === 'live'
                    ? `${list.models.length} models from ${label}.`
                    : `Built-in list for ${label}; the live one could not be fetched. Any model id works.`}
              </p>
            </fieldset>
          );
        })}
        <p className="settings__note">
          On Token Factory, a pet on a text-only Nemotron model reads screenshots with Nemotron Nano
          2 VL automatically. Names, personas and colours are in Settings.
        </p>
      </>
    ),
    hotkeys: (
      <>
        <dl className="onboarding__keys">
          <dt>{key(hotkeys.ask, SETTINGS_DEFAULTS.hotkeys.ask)}</dt>
          <dd>Ask. Brings up the panel with whatever text you have selected.</dd>
          <dt>{key(hotkeys.look, SETTINGS_DEFAULTS.hotkeys.look)}</dt>
          <dd>Look. The same, plus a screenshot of the window you are in.</dd>
          <dt>{key(hotkeys.seeEverything, SETTINGS_DEFAULTS.hotkeys.seeEverything)}</dt>
          <dd>See everything. Every screen, and a list of what is open.</dd>
          <dt>{key(hotkeys.pauseSight, SETTINGS_DEFAULTS.hotkeys.pauseSight)}</dt>
          <dd>Pause sight. Nothing is read until you press it again.</dd>
        </dl>
        <p>
          In the panel, start a message with <code>@Ink</code> to hand the conversation to Ink, or
          with <code>/crew</code> to ask the whole crew at once. Pets also ask each other when one
          knows better.
        </p>
        <p className="settings__note">Every key can be changed in Settings.</p>
      </>
    ),
    memory: (
      <>
        <p>
          With rolling memory on, Tagalong keeps a small picture of each screen every five seconds,
          in memory only, so you can ask “what was I reading five minutes ago?”. It is never written
          to disk, excluded apps are never recorded, pausing sight throws it away, and a red dot
          shows while it records.
        </p>
        <label className="settings__check">
          <input
            type="checkbox"
            checked={memory.enabled}
            onChange={(event) => setMemory({ ...memory, enabled: event.target.checked })}
          />
          <span>Turn on rolling memory</span>
        </label>
        <label>
          <span>Minutes to remember</span>
          <input
            type="number"
            min={1}
            max={MAX_ROLLING_MEMORY_MINUTES}
            value={memory.minutes}
            onChange={(event) => setMemory({ ...memory, minutes: event.target.value })}
          />
        </label>
        <p className="settings__note">
          Off by default. You can also ask a pet to “tell me when this finishes”: it watches the
          screen and pings you, using a small, cheap model for the checks.
        </p>
      </>
    ),
    extension: (
      <>
        <p>
          The Chrome extension lets your pets read the exact page you are on, in a side panel, with
          the same crew.
        </p>
        <ol>
          <li>
            Open <code>chrome://extensions</code> in Chrome and turn on{' '}
            <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose{' '}
            {view.extensionFolder === undefined ? (
              <>
                the extension folder. It is not on this machine yet: build it with{' '}
                <code>pnpm --filter @tagalong/extension build</code>.
              </>
            ) : (
              <>
                <code>{view.extensionFolder}</code>{' '}
                <button
                  type="button"
                  onClick={() => void window.tagalongHost.showExtensionFolder()}
                >
                  Show folder
                </button>
              </>
            )}
          </li>
          <li>Open the extension&apos;s options, paste the token below, and save.</li>
        </ol>
        {view.pairingToken === undefined ? (
          <p className="settings__error">The pairing token appears once the engine is running.</p>
        ) : (
          <PairingToken token={view.pairingToken} />
        )}
      </>
    ),
    finish: (
      <>
        <p>
          Select some text anywhere and press{' '}
          <strong>{key(hotkeys.ask, SETTINGS_DEFAULTS.hotkeys.ask)}</strong>, or ask Scout something
          now.
        </p>
        <p className="settings__note">
          This wizard is in the tray menu and in Settings if you want it again.
        </p>
      </>
    ),
  };

  const last = step === ONBOARDING_STEPS.length - 1;
  return (
    <main className="onboarding">
      <header>
        <p className="settings__note">
          Step {step + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h1>{current.title}</h1>
      </header>
      <section className="onboarding__body" data-testid={`step-${current.id}`}>
        {body[current.id]}
      </section>
      {problem !== null && (
        <p className="settings__error" role="alert">
          {problem}
        </p>
      )}
      <footer className="onboarding__nav">
        {!last && (
          <button type="button" onClick={() => finish(false)}>
            Skip setup
          </button>
        )}
        {step > 0 && (
          <button type="button" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {last ? (
          <>
            <button type="button" onClick={() => finish(false)}>
              Close
            </button>
            <button type="button" onClick={() => finish(true)}>
              Ask Scout something
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void next()}>
            {busy ? 'Saving…' : 'Next'}
          </button>
        )}
      </footer>
    </main>
  );
}

/** The pairing token, selectable and copyable, as Settings shows it. */
function PairingToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label>
      <span>Pairing token</span>
      <input readOnly value={token} onFocus={(event) => event.currentTarget.select()} />
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(token).then(() => setCopied(true))}
      >
        {copied ? 'Copied' : 'Copy token'}
      </button>
    </label>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Onboarding />
    </StrictMode>,
  );
}
