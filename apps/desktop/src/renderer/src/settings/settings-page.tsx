import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SETTINGS_CSS } from '@tagalong/ui';
import { buildSettingsPatch } from '../settings-form';
import { AwarenessSection } from './awareness-section';
import { BrowserSection } from './browser-section';
import { HotkeysSection } from './hotkeys-section';
import { KeysSection } from './keys-section';
import { SECTIONS } from './section';
import { SightSection } from './sight-section';
import { SummariesSection } from './summaries-section';
import type { HostView } from '../../../shared/ipc';

/**
 * App-level settings: the provider keys and base URLs, summaries, the four hotkeys, sight,
 * awareness and the browser extension, one section per file under `settings/`. It is Home's
 * Settings page (`embedded`, no header or side menu of its own); the standalone window only
 * opens when the engine failed to start, since Home needs the engine.
 *
 * Keys are re-read by the engine before every ask and a provider is rebuilt when its key or
 * base URL changed, so those apply on the next ask. Hotkeys are re-registered by main on
 * save, and the sight settings are read per capture.
 */
export function SettingsPage({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = useState<HostView | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
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

  if (view === null) {
    return (
      <main className="tg-settings">
        <style>{SETTINGS_CSS}</style>
        <p style={{ padding: 20 }}>Loading…</p>
      </main>
    );
  }

  const { settings } = view;
  const presets = view.providers.filter((choice) => choice.defaultBaseUrl !== undefined);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (view === null) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => String(form.get(name) ?? '');
    try {
      // Everything is validated before anything is written, so a typo in one field cannot
      // leave the hotkeys saved and the keys not.
      const patch = buildSettingsPatch({
        baseUrls: presets.map((choice) => ({
          providerId: choice.id,
          label: choice.label,
          value: field(`baseUrl:${choice.id}`),
        })),
        askHotkey: field('askHotkey'),
        lookHotkey: field('lookHotkey'),
        seeEverythingHotkey: field('seeEverythingHotkey'),
        pauseSightHotkey: field('pauseSightHotkey'),
        sightDetail: field('sightDetail'),
        windowTextBudget: field('windowTextBudget'),
        summarizerProviderId: field('summarizerProviderId'),
        summarizerModel: field('summarizerModel'),
        rollingMemoryEnabled: form.get('rollingMemoryEnabled') !== null,
        rollingMemoryMinutes: field('rollingMemoryMinutes'),
        watchMaxChecks: field('watchMaxChecks'),
        watchMaxConcurrent: field('watchMaxConcurrent'),
        watchTimeoutMinutes: field('watchTimeoutMinutes'),
      });
      const saved = await window.tagalongHost.saveSettings(patch);
      const typed = Object.entries(keys).filter(([, value]) => value.length > 0);
      for (const [providerId, value] of typed) {
        await window.tagalongHost.saveApiKey(providerId, value);
      }
      setKeys({});
      const newlyStored = new Set(typed.map(([providerId]) => providerId));
      setView((current) =>
        current === null
          ? current
          : {
              ...current,
              settings: saved,
              providers: current.providers.map((choice) =>
                newlyStored.has(choice.id) ? { ...choice, hasKey: true } : choice,
              ),
            },
      );
      setStatus('Saved. Everything applies from the next ask, keys and base URLs included.');
      setStatusIsError(false);
    } catch (error) {
      // The builders throw with the field named, so this reaches the user as
      // "Scout needs a model id." rather than a bare validation complaint.
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusIsError(true);
    }
  }

  return (
    <form
      className={embedded ? 'tg-settings tg-settings--embedded' : 'tg-settings'}
      onSubmit={(event) => void save(event)}
    >
      <style>{SETTINGS_CSS}</style>
      {!embedded && (
        <>
          <header className="tg-bar">
            <h1 className="tg-px tg-bar__title">Settings</h1>
            <span className="tg-bar__meta">
              Engine {view.engineVersion} on 127.0.0.1:{settings.enginePort}
            </span>
            <button type="submit" className="tg-btn">
              Save
            </button>
          </header>
          <nav className="tg-nav" aria-label="Settings">
            <div>
              <p className="tg-px tg-nav__heading">AGENTS</p>
              <p className="tg-nav__note">
                Each agent&apos;s role, brain, tools and notes live in Home.
              </p>
              <button
                type="button"
                className="tg-btn-quiet"
                style={{ width: '100%' }}
                onClick={() => void window.tagalongHost.openOffice()}
              >
                Open Home
              </button>
            </div>
            <ul>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
      <main className="tg-main">
        <KeysSection
          providers={view.providers}
          settings={settings}
          keys={keys}
          onKeysChange={setKeys}
        />
        <SummariesSection providers={view.providers} settings={settings} />
        <HotkeysSection settings={settings} hotkeyError={view.hotkeyError} />
        <SightSection settings={settings} />
        <AwarenessSection settings={settings} />
        <BrowserSection token={view.pairingToken} />
        <div className="tg-footer">
          <button type="submit" className="tg-btn">
            Save
          </button>
          <button
            type="button"
            className="tg-btn-quiet"
            onClick={() => void window.tagalongHost.openOnboarding()}
          >
            Open Welcome again
          </button>
          {status !== '' && (
            <p
              className={statusIsError ? 'tg-error' : undefined}
              role={statusIsError ? 'alert' : 'status'}
            >
              {statusIsError ? `Not saved. ${status}` : status}
            </p>
          )}
        </div>
      </main>
    </form>
  );
}
