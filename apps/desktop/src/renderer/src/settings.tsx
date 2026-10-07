import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { CrewList, SETTINGS_CSS } from '@tagalong/ui';
import type { Role } from '@tagalong/protocol';
// Bundled, not fetched: the two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './settings.css';
import { buildPet, newPet, roleVersionFor } from './pet-form';
import { buildSettingsPatch } from './settings-form';
import { AwarenessSection } from './settings/awareness-section';
import { BrowserSection } from './settings/browser-section';
import { HotkeysSection } from './settings/hotkeys-section';
import { KeysSection } from './settings/keys-section';
import { PetsSection } from './settings/pets-section';
import type { Recommend } from './settings/pets-section';
import { SECTIONS } from './settings/section';
import { SightSection } from './settings/sight-section';
import { SummariesSection } from './settings/summaries-section';
import type { HostView } from '../../shared/ipc';

/**
 * The model a role would like on a provider, from the engine's tier table. Stable, so the
 * editors' recommendation effect runs only when a pet's role or provider changes.
 */
const recommend: Recommend = (roleId, providerId) =>
  window.tagalong.recommendModel(roleId, providerId);

/**
 * Each pet's role and brain, the provider keys and base URLs, the four hotkeys, and the
 * controls over what looking costs, one section per file under `settings/`.
 *
 * A pet's role, provider and model apply on its next ask, because the engine looks the pet
 * up per turn. Keys are re-read by the engine before every ask and a provider is rebuilt
 * when its key or base URL changed, so those apply on the next ask too. Hotkeys are
 * re-registered by main on save, and the sight settings are read per capture.
 */
function Settings() {
  const [view, setView] = useState<HostView | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  // A refused save has to look refused. Rendering it in the same muted style as "Saved."
  // is how a user reads a rejection as a confirmation and walks away.
  const [statusIsError, setStatusIsError] = useState(false);
  // Pets the user deleted in this window; they go when Save is pressed, not before.
  const [removed, setRemoved] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Empty until the engine answers: the editors say the roles are loading, and a save keeps
  // each pet's role as it is.
  const [roles, setRoles] = useState<readonly Role[]>([]);

  useEffect(() => {
    window.tagalong
      .listRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

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
  const kept = view.pets.filter((pet) => !removed.includes(pet.id));
  const shownId = kept.some((pet) => pet.id === selectedId) ? selectedId : (kept[0]?.id ?? null);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (view === null) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => String(form.get(name) ?? '');
    try {
      // Everything is validated before anything is written, so a typo in one pet's
      // model cannot leave the hotkeys saved and the pets not.
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
        // Only meaningful with the engine up: pets live in its database.
        ...(view.pets.length > 0
          ? {
              hiddenPets: kept
                .filter((pet) => form.get(`pet:${pet.id}:shown`) === null)
                .map((pet) => pet.id),
            }
          : {}),
        summarizerProviderId: field('summarizerProviderId'),
        summarizerModel: field('summarizerModel'),
        rollingMemoryEnabled: form.get('rollingMemoryEnabled') !== null,
        rollingMemoryMinutes: field('rollingMemoryMinutes'),
        watchMaxChecks: field('watchMaxChecks'),
        watchMaxConcurrent: field('watchMaxConcurrent'),
        watchTimeoutMinutes: field('watchTimeoutMinutes'),
      });
      const pets = kept.map((pet) => {
        const petField = (name: string): string => field(`pet:${pet.id}:${name}`);
        const roleId = petField('roleId');
        return buildPet(pet, {
          providerId: petField('providerId'),
          model: petField('model'),
          visionModel: petField('visionModel'),
          name: petField('name'),
          avatar: petField('avatar'),
          notes: petField('notes'),
          color: petField('color'),
          voiceId: petField('voiceId'),
          replyStyle: petField('replyStyle'),
          watchModel: petField('watchModel'),
          roleId,
          roleVersion: roleVersionFor(pet, roleId, roles),
          toolGrants: petField('toolGrants'),
        });
      });

      const saved = await window.tagalongHost.saveSettings(patch);
      for (const petId of removed) await window.tagalongHost.deletePet(petId);
      setRemoved([]);
      const savedPets = await Promise.all(pets.map((pet) => window.tagalongHost.savePet(pet)));
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
              pets: savedPets,
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

  function addPet(): void {
    if (view === null) return;
    const pet = newPet(view.pets.map((p) => p.id));
    setView({ ...view, pets: [...view.pets, pet] });
    setSelectedId(pet.id);
  }

  return (
    <form className="tg-settings" onSubmit={(event) => void save(event)}>
      <style>{SETTINGS_CSS}</style>
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
          <p className="tg-px tg-nav__heading">CREW · {kept.length}</p>
          <CrewList pets={kept} roles={roles} selectedId={shownId} onSelect={setSelectedId} />
          {view.pets.length > 0 && (
            <button
              type="button"
              className="tg-btn-quiet"
              style={{ width: '100%', marginTop: 8 }}
              onClick={addPet}
            >
              Add a pet
            </button>
          )}
        </div>
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="tg-main">
        <PetsSection
          pets={kept}
          roles={roles}
          providers={view.providers}
          hiddenPets={settings.hiddenPets}
          selectedId={shownId}
          removedCount={removed.length}
          recommend={recommend}
          watchModelDefaults={view.watchModelDefaults}
          onDelete={(petId) => setRemoved((current) => [...current, petId])}
        />
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
            Run the setup wizard again
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

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Settings />
    </StrictMode>,
  );
}
