import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import './app.css';
import { buildPet } from './pet-form';
import { buildSettingsPatch } from './settings-form';
import type { HostView, ModelList, ProviderChoice } from '../../shared/ipc';

/**
 * One pet's brain: which provider, which model, and which model looks at pictures.
 *
 * The provider is controlled so the suggestions follow it: picking OpenRouter fills the
 * model box's list from OpenRouter's own `GET /models` (or the built-in list, which the
 * note then admits). The boxes still take any id, because a list is a convenience and
 * the service is the authority on what it serves.
 */
function PetBrain({ pet, providers }: { pet: Pet; providers: readonly ProviderChoice[] }) {
  const [providerId, setProviderId] = useState(pet.providerId);
  const [models, setModels] = useState<ModelList | null>(null);

  useEffect(() => {
    let current = true;
    window.tagalongHost
      .listModels(providerId)
      .then((list) => {
        if (current) setModels(list);
      })
      .catch(() => {
        if (current) setModels({ models: [], source: 'fallback' });
      });
    return () => {
      current = false;
    };
  }, [providerId]);

  const listId = `models-${pet.id}`;
  const label = providers.find((choice) => choice.id === providerId)?.label ?? providerId;
  return (
    <fieldset className="settings__pet">
      <legend>
        {pet.avatar} {pet.name}
      </legend>
      <label>
        <span>Provider</span>
        <select
          name={`pet:${pet.id}:providerId`}
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {providers.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model id</span>
        <input name={`pet:${pet.id}:model`} defaultValue={pet.model} list={listId} />
      </label>
      <label>
        <span>Vision model id (blank if the model above can see images)</span>
        <input
          name={`pet:${pet.id}:visionModel`}
          defaultValue={pet.visionModel ?? ''}
          list={listId}
        />
      </label>
      <datalist id={listId}>
        {(models?.models ?? []).map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <p className="settings__note">
        {models === null
          ? 'Loading models…'
          : models.source === 'live'
            ? `${models.models.length} models from ${label}.`
            : `Built-in list for ${label}. Store a key and reopen Settings to see the live one.`}
      </p>
    </fieldset>
  );
}

/**
 * Each pet's brain, the provider keys and base URLs, the four hotkeys, and the two
 * controls over what looking costs.
 *
 * A stored key is never read back into the form — `hasKey` is all main will say — so a
 * saved secret cannot be recovered from a window someone left open.
 *
 * A pet's provider and model apply on its next ask, because the engine looks the pet up
 * per turn. Keys and base URLs are read when a provider is first built, so those two
 * need a restart, and the note under the button says so. Hotkeys are re-registered by
 * main on save, and the sight settings are read per capture.
 */
function Settings() {
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

  if (view === null) return <main className="settings">Loading…</main>;

  const { settings } = view;

  const presets = view.providers.filter((choice) => choice.defaultBaseUrl !== undefined);
  const keyed = view.providers.filter((choice) => choice.needsKey);

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
      });
      const pets = view.pets.map((pet) =>
        buildPet(pet, {
          providerId: field(`pet:${pet.id}:providerId`),
          model: field(`pet:${pet.id}:model`),
          visionModel: field(`pet:${pet.id}:visionModel`),
        }),
      );

      const saved = await window.tagalongHost.saveSettings(patch);
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
      setStatus(
        'Saved. Pets, hotkeys and sight settings apply now; a new key or base URL needs a restart.',
      );
      setStatusIsError(false);
    } catch (error) {
      // The builders throw with the field named, so this reaches the user as
      // "Scout needs a model id." rather than a bare validation complaint.
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusIsError(true);
    }
  }

  return (
    <main className="settings">
      <form onSubmit={(event) => void save(event)}>
        {view.pets.length === 0 ? (
          <p className="settings__note">
            Pets appear here once the engine is running. Keys and base URLs can still be saved.
          </p>
        ) : (
          view.pets.map((pet) => <PetBrain key={pet.id} pet={pet} providers={view.providers} />)
        )}

        {keyed.map((choice) => (
          <label key={choice.id}>
            <span>
              {choice.label} API key{choice.envVar === undefined ? '' : ` (${choice.envVar})`}{' '}
              {choice.hasKey ? '(one is stored — type to replace it)' : '(none stored)'}
            </span>
            <input
              type="password"
              name={`key:${choice.id}`}
              autoComplete="off"
              value={keys[choice.id] ?? ''}
              onChange={(event) => setKeys({ ...keys, [choice.id]: event.target.value })}
            />
          </label>
        ))}

        {presets.map((choice) => (
          <label key={choice.id}>
            <span>{choice.label} base URL (blank for the default)</span>
            <input
              name={`baseUrl:${choice.id}`}
              defaultValue={settings.providerBaseUrls[choice.id] ?? ''}
              placeholder={choice.defaultBaseUrl}
            />
          </label>
        ))}
        <p className="settings__note">
          Any OpenAI-compatible service works: point one of these at its base URL, store its key,
          and give the pet one of its model ids.
        </p>

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

        {view.pairingToken !== undefined && <PairingToken token={view.pairingToken} />}

        <button type="submit">Save</button>
        <p className="settings__note">
          Engine {view.engineVersion} on 127.0.0.1:{settings.enginePort}. Keys are encrypted with
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

/**
 * The token the Chrome extension needs, once. Read-only and selectable, with a copy button,
 * because the alternative is asking someone to find a file in their profile folder.
 */
function PairingToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <fieldset>
      <legend>Browser extension</legend>
      <label>
        <span>Pairing token</span>
        <input
          name="pairingToken"
          readOnly
          value={token}
          onFocus={(event) => event.currentTarget.select()}
          data-testid="pairing-token"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(token).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy token'}
      </button>
      <p className="settings__note">
        Paste it into the Tagalong extension&apos;s options page in Chrome. Anyone with this token
        can drive your pets from this computer, so keep it to yourself.
      </p>
    </fieldset>
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
