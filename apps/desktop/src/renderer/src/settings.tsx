import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import './app.css';
import { buildSettingsPatch } from './settings-form';
import type { HostView } from '../../shared/ipc';

/**
 * Provider, key, model, the four hotkeys, and the two controls over what looking costs.
 *
 * The stored key is never read back into the form — `hasApiKey` is all main will say —
 * so a saved secret cannot be recovered from a window someone left open.
 *
 * Everything here except the provider and the key takes effect immediately. The hotkeys
 * are re-registered by main on save, and the sight settings are read per capture, so the
 * note under the button promises a restart only for the two that need one.
 */
function Settings() {
  const [view, setView] = useState<HostView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  // A refused save has to look refused. Rendering it in the same muted style as "Saved."
  // is how a user reads a rejection as a confirmation and walks away.
  const [statusIsError, setStatusIsError] = useState(false);

  useEffect(() => {
    window.tagalongHost
      .getHostView()
      .then(setView)
      .catch((error: unknown) => {
        setStatus(String(error));
        setStatusIsError(true);
      });
  }, []);

  // Saving a fixed accelerator re-registers it in main, which is where the outcome is
  // known. Without this the window would keep showing the old failure next to the very
  // field that just corrected it.
  useEffect(
    () =>
      window.tagalongHost.onHotkeyProblem((problem) =>
        setView((current) => {
          if (current === null) return current;
          // Rebuilt without the key rather than spread over: spreading `{}` for the
          // fixed case would leave the stale error exactly where it is least welcome.
          const { hotkeyError: _cleared, ...rest } = current;
          return problem === null ? rest : { ...rest, hotkeyError: problem };
        }),
      ),
    [],
  );

  if (view === null) return <main className="settings">Loading…</main>;

  const { settings } = view;

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const saved = await window.tagalongHost.saveSettings(
        buildSettingsPatch({
          providerId: String(form.get('providerId')),
          defaultModel: String(form.get('defaultModel')),
          askHotkey: String(form.get('askHotkey')),
          lookHotkey: String(form.get('lookHotkey')),
          seeEverythingHotkey: String(form.get('seeEverythingHotkey')),
          pauseSightHotkey: String(form.get('pauseSightHotkey')),
          sightDetail: String(form.get('sightDetail')),
          windowTextBudget: String(form.get('windowTextBudget')),
        }),
      );
      if (apiKey.length > 0) {
        await window.tagalongHost.saveApiKey(apiKey);
        setApiKey('');
      }
      setView((current) =>
        current === null
          ? current
          : { ...current, settings: saved, hasApiKey: current.hasApiKey || apiKey.length > 0 },
      );
      setStatus(
        'Saved. Hotkeys and sight settings apply now; a new provider or key needs a restart.',
      );
      setStatusIsError(false);
    } catch (error) {
      // buildSettingsPatch throws with the field named, so this reaches the user as
      // "Window text budget must be…" rather than a bare validation complaint.
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusIsError(true);
    }
  }

  return (
    <main className="settings">
      <form onSubmit={(event) => void save(event)}>
        <label>
          <span>Provider</span>
          <select name="providerId" defaultValue={settings.providerId}>
            <option value="anthropic">Anthropic</option>
            <option value="fake">Fake (offline demo)</option>
          </select>
        </label>

        <label>
          <span>
            Anthropic API key{' '}
            {view.hasApiKey ? '(one is stored — type to replace it)' : '(none stored)'}
          </span>
          <input
            type="password"
            name="apiKey"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>

        <label>
          <span>Default model</span>
          <input name="defaultModel" defaultValue={settings.defaultModel} />
        </label>

        <label>
          <span>Ask hotkey (text only)</span>
          <input name="askHotkey" defaultValue={settings.hotkeys.ask} />
        </label>

        <label>
          <span>Look hotkey (adds a screenshot)</span>
          <input
            name="lookHotkey"
            defaultValue={settings.hotkeys.look ?? SETTINGS_DEFAULTS.hotkeys.look}
          />
        </label>

        <label>
          <span>See-everything hotkey (every screen, plus what is open)</span>
          <input
            name="seeEverythingHotkey"
            defaultValue={settings.hotkeys.seeEverything ?? SETTINGS_DEFAULTS.hotkeys.seeEverything}
          />
        </label>

        <label>
          <span>Pause sight hotkey (turns all looking off and on)</span>
          <input
            name="pauseSightHotkey"
            defaultValue={settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight}
          />
        </label>

        <label>
          <span>What a see-everything look sends</span>
          <select name="sightDetail" defaultValue={settings.sightDetail}>
            <option value="focused">
              The composite and the screen you are on (cheaper, recommended)
            </option>
            <option value="all">Every screen as its own picture</option>
          </select>
        </label>
        <p className="settings__note">
          Every screen sends one picture per monitor. On a three-monitor desk that is roughly three
          times the image cost on every look, so the default sends an overview plus the screen you
          are working on and lets the pet ask for another if it needs one.
        </p>

        <label>
          <span>Window text budget (characters per window read)</span>
          <input
            name="windowTextBudget"
            type="number"
            min={1}
            max={MAX_WINDOW_TEXT_CHARS}
            step={500}
            defaultValue={settings.windowTextBudget}
          />
        </label>
        <p className="settings__note">
          How much of a window the pet reads when it does not ask for less. Roughly one token per
          four characters, so {SETTINGS_DEFAULTS.windowTextBudget} is about{' '}
          {Math.round(SETTINGS_DEFAULTS.windowTextBudget / 4)} tokens per window read — raising it
          costs that much more every time, on every read.
        </p>

        {view.hotkeyError !== undefined && <p className="settings__error">{view.hotkeyError}</p>}

        <button type="submit">Save</button>
        <p className="settings__note">
          Engine {view.engineVersion} on 127.0.0.1:{settings.enginePort}. The key is encrypted with
          the OS keychain and never written in plain text.
        </p>
        {status !== '' && (
          <p
            className={statusIsError ? 'settings__error' : 'settings__note'}
            role={statusIsError ? 'alert' : 'status'}
          >
            {status}
          </p>
        )}
      </form>
    </main>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Settings />
    </StrictMode>,
  );
}
