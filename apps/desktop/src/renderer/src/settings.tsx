import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import type { HostView } from '../../shared/ipc';

/**
 * Phase 1 settings: provider, key, model, and the hotkey as read-only text.
 *
 * The stored key is never read back into the form — `hasApiKey` is all main will say —
 * so a saved secret cannot be recovered from a window someone left open.
 */
function Settings() {
  const [view, setView] = useState<HostView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.tagalongHost
      .getHostView()
      .then(setView)
      .catch((error: unknown) => setStatus(String(error)));
  }, []);

  if (view === null) return <main className="settings">Loading…</main>;

  const { settings } = view;

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const saved = await window.tagalongHost.saveSettings({
        providerId: String(form.get('providerId')),
        defaultModel: String(form.get('defaultModel')),
      });
      if (apiKey.length > 0) {
        await window.tagalongHost.saveApiKey(apiKey);
        setApiKey('');
      }
      setView((current) =>
        current === null
          ? current
          : { ...current, settings: saved, hasApiKey: current.hasApiKey || apiKey.length > 0 },
      );
      setStatus('Saved. Restart Tagalong to pick up a new provider or key.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
          <span>Ask hotkey (editable in Phase 7)</span>
          <input value={settings.hotkeys.ask} readOnly />
        </label>

        {view.hotkeyError !== undefined && <p className="settings__error">{view.hotkeyError}</p>}

        <button type="submit">Save</button>
        <p className="settings__note">
          Engine {view.engineVersion} on 127.0.0.1:{settings.enginePort}. The key is encrypted with
          the OS keychain and never written in plain text.
        </p>
        {status !== '' && <p className="settings__note">{status}</p>}
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
