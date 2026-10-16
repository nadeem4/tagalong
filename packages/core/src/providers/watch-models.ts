/**
 * The cheap model a watch's yes-or-no check runs on, per provider. Contains
 * `WATCH_MODEL_DEFAULTS` and `watchModelsFor`.
 */

/**
 * The cheap check model each provider defaults to.
 *
 * A watch can ask its model up to sixty times, so it must not be the pet's own: an Opus call
 * every few seconds is the cost the threshold exists to avoid. Each default lives on the
 * pet's own provider so a watch never needs a second key.
 */
export const WATCH_MODEL_DEFAULTS: Readonly<Record<string, string>> = {
  openrouter: 'anthropic/claude-haiku-4.5',
  anthropic: 'claude-haiku-4-5',
  fake: 'fake-model',
};

export interface WatchModels {
  model: string;
}

/** The model a pet's watch checks run on: its own pick, else its provider's default. */
export function watchModelsFor(pet: {
  model: string;
  providerId: string;
  watchModel?: string | undefined;
}): WatchModels {
  return { model: pet.watchModel ?? WATCH_MODEL_DEFAULTS[pet.providerId] ?? pet.model };
}
