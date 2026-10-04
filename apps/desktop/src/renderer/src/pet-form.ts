import { Pet } from '@tagalong/protocol';

/** One pet's brain, as the settings form holds it: every field a string. */
export interface PetFormValues {
  providerId: string;
  model: string;
  /** Empty means none: the pet's model sees on its own, or the pet never looks. */
  visionModel: string;
}

/**
 * The pet with its new brain, or an error a person can act on.
 *
 * Built over the stored pet so persona, avatar and permissions survive a save from a form
 * that never shows them. A blank vision model is removed rather than kept as an empty
 * string: moving Scout from Nemotron to Claude on OpenRouter should leave nothing behind
 * that would route a picture to a Token Factory model on another service.
 */
export function buildPet(pet: Pet, values: PetFormValues): Pet {
  const providerId = values.providerId.trim();
  const model = values.model.trim();
  const visionModel = values.visionModel.trim();
  if (providerId.length === 0) throw new Error(`${pet.name} needs a provider.`);
  if (model.length === 0) throw new Error(`${pet.name} needs a model id.`);

  const { visionModel: _previous, ...rest } = pet;
  return Pet.parse({
    ...rest,
    providerId,
    model,
    ...(visionModel.length > 0 ? { visionModel } : {}),
  });
}
