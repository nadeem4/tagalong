import { useEffect, useId, useState } from 'react';
import type { Pet, ReplyStyle, Role } from '@tagalong/protocol';
import { DEFAULT_PET_COLOR } from '../crew-strip';
import { useHostBridge } from '../host-bridge';
import type { ModelRecommendation } from '../settings/brain-picker';
import { PetSettings } from '../settings/pet-settings';
import type { PetDraft } from '../settings/pet-settings';

/**
 * What Home needs from its host to change an agent. Saving goes through `pets.upsert` in
 * the host, the desktop pet is `settings.defaultPetId`. Separate from the HostBridge because
 * a host that cannot edit agents simply passes none and Home shows the agents read-only.
 */
export interface AgentHost {
  /** The brains an agent can run on, and which agent the desktop shows. */
  setup(): Promise<{
    providers: readonly { id: string; label: string }[];
    desktopPetId: string;
    /** The provider a new agent starts on: the first with a key, or the default one. */
    newAgentProviderId: string;
  }>;
  listModels(providerId: string): Promise<{ models: string[]; source: 'live' | 'fallback' }>;
  savePet(pet: Pet): Promise<Pet>;
  deletePet(petId: string): Promise<boolean>;
  setDesktopPet(petId: string): Promise<void>;
}

export interface AgentControlsProps {
  pet: Pet;
  roles: readonly Role[];
  providers: readonly { id: string; label: string }[];
  host: AgentHost;
  desktopPetId: string;
  onDesktopPet: (petId: string) => void;
  onSaved: (pet: Pet) => void;
  onDeleted: (petId: string) => void;
}

interface Look {
  avatar: string;
  color: string;
  replyStyle: ReplyStyle;
  /** Empty means the provider's default. */
  watchModel: string;
}

const draftOf = (pet: Pet): PetDraft => ({
  name: pet.name,
  roleId: pet.roleId,
  providerId: pet.providerId,
  model: pet.model,
  visionModel: pet.visionModel ?? '',
  toolGrants: pet.toolGrants,
  notes: pet.notes ?? '',
});

/** The pet to save, or a sentence naming what is missing. */
function buildPet(pet: Pet, draft: PetDraft, look: Look): Pet | string {
  const name = draft.name.trim();
  if (name.length === 0) return 'Give the agent a name.';
  const model = draft.model.trim();
  if (model.length === 0) return `${name} needs a model id.`;
  const avatar = look.avatar.trim();
  const { visionModel: _vision, notes: _notes, watchModel: _watch, ...rest } = pet;
  const optional = (key: string, value: string) =>
    value.trim().length === 0 ? {} : { [key]: value.trim() };
  return {
    ...rest,
    name,
    avatar: avatar.length > 0 ? avatar : pet.avatar,
    color: look.color.toLowerCase(),
    replyStyle: look.replyStyle,
    // A changed role takes its library version in the engine, on pets.upsert.
    roleId: draft.roleId,
    providerId: draft.providerId,
    model,
    toolGrants: draft.toolGrants,
    ...optional('visionModel', draft.visionModel),
    ...optional('notes', draft.notes),
    ...optional('watchModel', look.watchModel),
  };
}

/**
 * One agent's controls in Home: its role, brain, tools and notes beside the directory card
 * (the Settings components, unchanged), its look and reply style, whether it is the pet on
 * the desktop, and Save. Keyed by pet in Home, so picking another agent starts fresh.
 */
export function AgentControls({
  pet,
  roles,
  providers,
  host,
  desktopPetId,
  onDesktopPet,
  onSaved,
  onDeleted,
}: AgentControlsProps) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState<PetDraft>(() => draftOf(pet));
  const [look, setLook] = useState<Look>({
    avatar: pet.avatar,
    color: pet.color ?? DEFAULT_PET_COLOR,
    replyStyle: pet.replyStyle,
    watchModel: pet.watchModel ?? '',
  });
  const [models, setModels] = useState<{ models: string[]; source: string } | null>(null);
  const [recommended, setRecommended] = useState<ModelRecommendation>({});
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const desktopHeading = useId();
  const { providerId, roleId } = draft;

  useEffect(() => {
    let current = true;
    host
      .listModels(providerId)
      .then((list) => current && setModels(list))
      .catch(() => current && setModels({ models: [], source: 'fallback' }));
    return () => {
      current = false;
    };
  }, [host, providerId]);

  useEffect(() => {
    let current = true;
    bridge
      .recommendModel(roleId, providerId)
      .then((next) => current && setRecommended(next))
      .catch(() => current && setRecommended({}));
    return () => {
      current = false;
    };
  }, [bridge, roleId, providerId]);

  const label = providers.find((choice) => choice.id === providerId)?.label ?? providerId;
  const name = draft.name.trim().length > 0 ? draft.name.trim() : pet.name;

  const save = (): void => {
    const next = buildPet(pet, draft, look);
    if (typeof next === 'string') {
      setStatus({ text: next, error: true });
      return;
    }
    host
      .savePet(next)
      .then((saved) => {
        setStatus({ text: `Saved. ${saved.name} works this way from the next ask.`, error: false });
        onSaved(saved);
      })
      .catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), error: true }),
      );
  };

  const putOnDesktop = (): void => {
    host
      .setDesktopPet(pet.id)
      .then(() => onDesktopPet(pet.id))
      .catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), error: true }),
      );
  };

  const remove = (): void => {
    host
      .deletePet(pet.id)
      .then(() => onDeleted(pet.id))
      .catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), error: true }),
      );
  };

  return (
    <div className="tg-panel home-controls">
      <PetSettings
        pet={pet}
        draft={draft}
        roles={roles}
        providers={providers}
        models={models?.models ?? []}
        modelsNote={
          models === null
            ? 'Loading models…'
            : models.source === 'live'
              ? `${models.models.length} models from ${label}.`
              : `Built-in list for ${label}. Store a key in Settings to see the live one.`
        }
        recommended={recommended}
        onChange={setDraft}
      >
        <h3>Look and reply</h3>
        <label>
          <span>Emoji</span>
          <input
            value={look.avatar}
            onChange={(event) => setLook({ ...look, avatar: event.target.value })}
          />
        </label>
        <label>
          <span>Colour</span>
          <input
            type="color"
            value={look.color}
            onChange={(event) => setLook({ ...look, color: event.target.value })}
          />
        </label>
        <label>
          <span>Reply style</span>
          <select
            value={look.replyStyle}
            onChange={(event) => setLook({ ...look, replyStyle: event.target.value as ReplyStyle })}
          >
            <option value="text">Text</option>
            <option value="voice-summary">Spoken summary (voice arrives with Phase 3)</option>
            <option value="voice-full">Spoken in full (voice arrives with Phase 3)</option>
          </select>
        </label>
        <label>
          <span>Watch check model (the small model that answers “has it happened yet?”)</span>
          <input
            value={look.watchModel}
            placeholder={`${label}’s default`}
            onChange={(event) => setLook({ ...look, watchModel: event.target.value })}
          />
        </label>
        <div role="group" aria-labelledby={desktopHeading}>
          <h3 id={desktopHeading}>Desktop pet</h3>
          {desktopPetId === pet.id ? (
            <p className="tg-note">{name} is the pet on your desktop.</p>
          ) : (
            <>
              <p className="tg-note">One pet sits on your desktop; the rest work from Home.</p>
              <button type="button" className="tg-btn-quiet" onClick={putOnDesktop}>
                Put {name} on the desktop
              </button>
            </>
          )}
        </div>
        <div className="tg-footer home-controls__footer">
          <button type="button" className="tg-btn" onClick={save}>
            Save {name}
          </button>
          {confirming ? (
            <>
              <button type="button" className="tg-btn-quiet" onClick={remove}>
                Delete {name} for good
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep {name}
              </button>
            </>
          ) : (
            <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
              Delete {name}
            </button>
          )}
          {confirming && (
            <p>Deleting takes {name} off the crew. A deleted default pet does not come back.</p>
          )}
          {status !== null && (
            <p
              className={status.error ? 'tg-error' : undefined}
              role={status.error ? 'alert' : 'status'}
            >
              {status.error ? `Not saved. ${status.text}` : status.text}
            </p>
          )}
        </div>
      </PetSettings>
    </div>
  );
}
