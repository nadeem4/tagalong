/**
 * The cheap model a watch's yes-or-no check runs on, per provider. Contains
 * `WATCH_MODEL_DEFAULTS` and `watchModelsFor`.
 */
import { NEMOTRON_NANO_MODEL, NEMOTRON_VISION_MODEL } from './nebius-models';

export { NEMOTRON_NANO_MODEL };

/**
 * The cheap check model each provider defaults to.
 *
 * A watch can ask its model up to sixty times, so it must not be the pet's own: an Opus or
 * Nemotron Super call every few seconds is the cost the threshold exists to avoid. Each
 * default lives on the pet's own provider so a watch never needs a second key.
 */
export const WATCH_MODEL_DEFAULTS: Readonly<Record<string, string>> = {
  nebius: NEMOTRON_NANO_MODEL,
  openrouter: 'anthropic/claude-haiku-4.5',
  anthropic: 'claude-haiku-4-5',
  fake: 'fake-model',
};

/** The vision model a check falls back to when its model cannot see, per provider. */
const WATCH_VISION_DEFAULTS: Readonly<Record<string, string>> = {
  nebius: NEMOTRON_VISION_MODEL,
};

export interface WatchModels {
  model: string;
  visionModel?: string;
}

/** The models a pet's watch checks run on: its own pick, else its provider's default. */
export function watchModelsFor(pet: {
  model: string;
  providerId: string;
  visionModel?: string | undefined;
  watchModel?: string | undefined;
}): WatchModels {
  const model = pet.watchModel ?? WATCH_MODEL_DEFAULTS[pet.providerId] ?? pet.model;
  const visionModel = pet.visionModel ?? WATCH_VISION_DEFAULTS[pet.providerId];
  return visionModel === undefined ? { model } : { model, visionModel };
}
