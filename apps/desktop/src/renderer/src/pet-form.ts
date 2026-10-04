import { Pet, ReplyStyle } from '@tagalong/protocol';

/**
 * One pet as the settings form holds it: every field a string.
 *
 * The brain fields are always present. The identity fields — what the Phase 4 pet editor
 * adds — are optional so a form that shows only the brain still saves cleanly.
 */
export interface PetFormValues {
  providerId: string;
  model: string;
  /** Empty means none: the pet's model sees on its own, or the pet never looks. */
  visionModel: string;
  name?: string;
  avatar?: string;
  persona?: string;
  /** `#rrggbb`, any case. */
  color?: string;
  /** Phase 3. Empty means none. */
  voiceId?: string;
  replyStyle?: string;
}

/**
 * The pet with its edits applied, or an error a person can act on.
 *
 * Built over the stored pet so permissions and anything else the form never shows survive
 * a save. A blank vision model or voice is removed rather than kept as an empty string:
 * moving Scout from Nemotron to Claude on OpenRouter should leave nothing behind that
 * would route a picture to a Token Factory model on another service.
 */
export function buildPet(pet: Pet, values: PetFormValues): Pet {
  const providerId = values.providerId.trim();
  const model = values.model.trim();
  const visionModel = values.visionModel.trim();
  if (providerId.length === 0) throw new Error(`${pet.name} needs a provider.`);
  if (model.length === 0) throw new Error(`${pet.name} needs a model id.`);

  const name = values.name?.trim();
  if (name !== undefined && name.length === 0) throw new Error(`${pet.name} needs a name.`);
  const avatar = values.avatar?.trim();
  if (avatar !== undefined && avatar.length === 0) throw new Error(`${pet.name} needs an emoji.`);
  const color = values.color?.trim().toLowerCase();
  if (color !== undefined && !/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error(`${pet.name}'s colour must look like #a855f7.`);
  }
  const replyStyle = values.replyStyle;
  if (replyStyle !== undefined && !ReplyStyle.safeParse(replyStyle).success) {
    throw new Error(`${pet.name} has a reply style this version does not know.`);
  }
  const voiceId = values.voiceId?.trim();

  const { visionModel: _previous, voiceId: _previousVoice, ...rest } = pet;
  return Pet.parse({
    ...rest,
    providerId,
    model,
    ...(visionModel.length > 0 ? { visionModel } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(avatar !== undefined ? { avatar } : {}),
    ...(values.persona !== undefined ? { persona: values.persona.trim() } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(replyStyle !== undefined ? { replyStyle } : {}),
    // An untouched voice survives a brain-only save; a cleared one is removed.
    ...(voiceId === undefined
      ? pet.voiceId === undefined
        ? {}
        : { voiceId: pet.voiceId }
      : voiceId.length > 0
        ? { voiceId }
        : {}),
  });
}

/** A lowercase, dash-separated id from a name, unique among `taken`. */
export function petIdFor(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pet';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * A blank pet for the editor's Add button. It starts on the fake brain so saving it
 * before choosing a provider costs nothing and never fails for want of a key.
 */
export function newPet(taken: readonly string[]): Pet {
  return Pet.parse({
    id: petIdFor('pet', taken),
    name: 'New pet',
    avatar: '🐾',
    color: '#64748b',
    persona: '',
    model: 'fake-model',
    providerId: 'fake',
  });
}
