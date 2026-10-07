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
  /** The user's private notes for the pet. Empty means none. */
  notes?: string;
  /** `#rrggbb`, any case. */
  color?: string;
  /** Phase 3. Empty means none. */
  voiceId?: string;
  replyStyle?: string;
  /** Phase 3B. The watch check model. Empty means the provider default; absent, untouched. */
  watchModel?: string;
  /** Phase 8. The role picked; absent leaves the pet's role alone. */
  roleId?: string;
  /** Phase 8. Goes with `roleId`: see `roleVersionFor`. */
  roleVersion?: number;
  /** Phase 8. The tool switches as JSON, tool id to `off` or `allowed`. */
  toolGrants?: string;
}

/**
 * The role version a pet saves with: the one it took its role at while the role is
 * unchanged, the library's current one for a newly picked role.
 */
export function roleVersionFor(
  pet: Pet,
  roleId: string,
  roles: readonly { id: string; version: number }[],
): number {
  if (roleId === pet.roleId) return pet.roleVersion;
  return roles.find((role) => role.id === roleId)?.version ?? 1;
}

/** The tool switches, or a sentence saying they could not be read. */
function parseGrants(pet: Pet, raw: string): Pet['toolGrants'] {
  const problem = `${pet.name}'s tool switches could not be read. Reopen Settings and try again.`;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(problem);
  }
  const parsed = Pet.shape.toolGrants.safeParse(value);
  if (!parsed.success) throw new Error(problem);
  return parsed.data;
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
  const notes = values.notes?.trim();
  const watchModel = values.watchModel?.trim();
  const toolGrants =
    values.toolGrants === undefined ? undefined : parseGrants(pet, values.toolGrants);

  const {
    visionModel: _previous,
    voiceId: _previousVoice,
    watchModel: _previousWatch,
    notes: _previousNotes,
    ...rest
  } = pet;
  return Pet.parse({
    ...rest,
    providerId,
    model,
    ...(visionModel.length > 0 ? { visionModel } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(avatar !== undefined ? { avatar } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(replyStyle !== undefined ? { replyStyle } : {}),
    ...(values.roleId !== undefined
      ? { roleId: values.roleId, roleVersion: values.roleVersion ?? pet.roleVersion }
      : {}),
    ...(toolGrants !== undefined ? { toolGrants } : {}),
    // An untouched voice survives a brain-only save; a cleared one is removed.
    ...(voiceId === undefined
      ? pet.voiceId === undefined
        ? {}
        : { voiceId: pet.voiceId }
      : voiceId.length > 0
        ? { voiceId }
        : {}),
    // The same rule for the notes: untouched survive, cleared are removed.
    ...(notes === undefined
      ? pet.notes === undefined
        ? {}
        : { notes: pet.notes }
      : notes.length > 0
        ? { notes }
        : {}),
    // The same rule for the watch check model: blank goes back to the provider default.
    ...(watchModel === undefined
      ? pet.watchModel === undefined
        ? {}
        : { watchModel: pet.watchModel }
      : watchModel.length > 0
        ? { watchModel }
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
    // Every new pet starts as a generalist until a role picker exists.
    roleId: 'generalist',
    roleVersion: 1,
    model: 'fake-model',
    providerId: 'fake',
  });
}
