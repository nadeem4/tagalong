import { useEffect, useState } from 'react';
import { DEFAULT_PET_COLOR, PetSettings } from '@tagalong/ui';
import type { ModelRecommendation, PetDraft } from '@tagalong/ui';
import type { Pet, Role } from '@tagalong/protocol';
import type { ModelList, ProviderChoice } from '../../../shared/ipc';
import { Section } from './section';

/** What a role would like on a provider; the host decides where that comes from. */
export type Recommend = (roleId: string, providerId: string) => Promise<ModelRecommendation>;

/**
 * One pet: its role, brain, tools and notes through `PetSettings`, then its look, reply
 * style and place on the desktop strip.
 *
 * The role-shaped fields are controlled and reach the form as hidden inputs, so the save
 * still reads one `FormData` for the whole window. The provider is controlled so the model
 * suggestions follow it: picking OpenRouter fills the list from OpenRouter's own
 * `GET /models` (or the built-in list, which the note then admits). The boxes still take any
 * id, because a list is a convenience and the service is the authority on what it serves.
 */
function PetEditor({
  pet,
  roles,
  providers,
  shown,
  hidden,
  onDelete,
  recommend,
  watchModelDefaults,
}: {
  pet: Pet;
  roles: readonly Role[];
  providers: readonly ProviderChoice[];
  shown: boolean;
  hidden: boolean;
  onDelete: () => void;
  recommend: Recommend;
  watchModelDefaults: Record<string, string>;
}) {
  const [draft, setDraft] = useState<PetDraft>({
    name: pet.name,
    roleId: pet.roleId,
    providerId: pet.providerId,
    model: pet.model,
    visionModel: pet.visionModel ?? '',
    toolGrants: pet.toolGrants,
    notes: pet.notes ?? '',
  });
  const [models, setModels] = useState<ModelList | null>(null);
  const [recommended, setRecommended] = useState<ModelRecommendation>({});
  const { providerId, roleId } = draft;

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

  useEffect(() => {
    let current = true;
    recommend(roleId, providerId)
      .then((next) => {
        if (current) setRecommended(next);
      })
      .catch(() => {
        if (current) setRecommended({});
      });
    return () => {
      current = false;
    };
  }, [recommend, roleId, providerId]);

  const label = providers.find((choice) => choice.id === providerId)?.label ?? providerId;
  const field = (name: string): string => `pet:${pet.id}:${name}`;
  const listId = `watch-models-${pet.id}`;
  return (
    <div hidden={hidden} data-testid={`pet-editor-${pet.id}`}>
      <input type="hidden" name={field('name')} value={draft.name} />
      <input type="hidden" name={field('roleId')} value={draft.roleId} />
      <input type="hidden" name={field('providerId')} value={draft.providerId} />
      <input type="hidden" name={field('model')} value={draft.model} />
      <input type="hidden" name={field('visionModel')} value={draft.visionModel} />
      <input type="hidden" name={field('notes')} value={draft.notes} />
      <input type="hidden" name={field('toolGrants')} value={JSON.stringify(draft.toolGrants)} />
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
              : `Built-in list for ${label}. Store a key and reopen Settings to see the live one.`
        }
        recommended={recommended}
        onChange={setDraft}
      >
        <h3>Look and reply</h3>
        <label>
          <span>Emoji</span>
          <input name={field('avatar')} defaultValue={pet.avatar} />
        </label>
        <label>
          <span>Colour</span>
          <input type="color" name={field('color')} defaultValue={pet.color ?? DEFAULT_PET_COLOR} />
        </label>
        <label>
          <span>Watch check model (the small model that answers “has it happened yet?”)</span>
          <input
            name={field('watchModel')}
            defaultValue={pet.watchModel ?? ''}
            placeholder={watchModelDefaults[providerId] ?? draft.model}
            list={listId}
          />
        </label>
        <datalist id={listId}>
          {(models?.models ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <p className="tg-note">
          Blank uses {label}’s default, {watchModelDefaults[providerId] ?? 'the pet’s own model'}. A
          watch can ask this model up to its check limit, so it should be small and cheap — Nemotron
          3 Nano on Token Factory, Claude Haiku on OpenRouter or Anthropic.
        </p>
        <label>
          <span>Reply style</span>
          <select name={field('replyStyle')} defaultValue={pet.replyStyle}>
            <option value="text">Text</option>
            <option value="voice-summary">Spoken summary (voice arrives with Phase 3)</option>
            <option value="voice-full">Spoken in full (voice arrives with Phase 3)</option>
          </select>
        </label>
        <label>
          <span>Voice id (Phase 3; stored, not used yet)</span>
          <input name={field('voiceId')} defaultValue={pet.voiceId ?? ''} />
        </label>
        <label className="tg-check">
          <input type="checkbox" name={field('shown')} defaultChecked={shown} />
          <span>Show on the desktop strip</span>
        </label>
        <button type="button" className="tg-btn-quiet" onClick={onDelete}>
          Delete {pet.name}
        </button>
      </PetSettings>
    </div>
  );
}

/**
 * Every pet's editor, with only the selected one shown. The others stay mounted (and in the
 * form) so an edit made to one pet survives picking another before saving.
 */
export function PetsSection({
  pets,
  roles,
  providers,
  hiddenPets,
  selectedId,
  removedCount,
  recommend,
  watchModelDefaults,
  onDelete,
}: {
  pets: readonly Pet[];
  roles: readonly Role[];
  providers: readonly ProviderChoice[];
  hiddenPets: readonly string[];
  selectedId: string | null;
  removedCount: number;
  recommend: Recommend;
  watchModelDefaults: Record<string, string>;
  onDelete: (petId: string) => void;
}) {
  return (
    <Section id="pets">
      {pets.length === 0 && (
        <p className="tg-note">
          {removedCount > 0
            ? 'Every pet is marked for deletion.'
            : 'Pets appear here once the engine is running. Keys and base URLs can still be saved.'}
        </p>
      )}
      {pets.map((pet) => (
        <PetEditor
          key={pet.id}
          pet={pet}
          roles={roles}
          providers={providers}
          shown={!hiddenPets.includes(pet.id)}
          hidden={pet.id !== selectedId}
          onDelete={() => onDelete(pet.id)}
          recommend={recommend}
          watchModelDefaults={watchModelDefaults}
        />
      ))}
      {removedCount > 0 && (
        <p className="tg-note">
          {removedCount} pet{removedCount === 1 ? '' : 's'} will be deleted when you save. A deleted
          default pet does not come back.
        </p>
      )}
    </Section>
  );
}
