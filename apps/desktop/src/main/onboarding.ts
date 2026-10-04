import {
  INK_MODEL,
  NEBIUS_VISION_MODELS,
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
} from '@tagalong/core';
import { Pet } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';

/**
 * The first-run setup wizard's main-process half: when it opens, what it suggests, and how
 * a pick becomes a pet. The window itself lives in the renderer; everything here is pure
 * so it can be tested without Electron.
 */

/** The providers the wizard offers, plus the offline fake for demos and tests. */
const WIZARD_PROVIDERS = ['openrouter', 'nebius', 'anthropic', 'fake'] as const;

/** One pet's pick in the crew step. */
export interface CrewChoice {
  providerId: string;
  model: string;
}

/**
 * Opens on a fresh install and on an install from before the wizard existed, once.
 *
 * `TAGALONG_SKIP_ONBOARDING=1` keeps it shut for the end-to-end smoke test, which counts
 * the windows a launch opens and drives the panel, not the wizard.
 */
export function shouldOpenOnboarding(
  settings: Settings,
  env: Record<string, string | undefined>,
): boolean {
  if (env.TAGALONG_SKIP_ONBOARDING === '1') return false;
  return !settings.onboarding.done;
}

/**
 * The model each default pet starts on, per provider.
 *
 * Token Factory puts the whole crew on Nemotron: Super for words, Nano 2 VL for Bolt, who
 * mostly reads screenshots of errors. OpenRouter and Anthropic put it on Claude, with the
 * small Haiku for Bolt. The wizard shows these as the starting value of each box and the
 * live list beside it, so a suggestion costs one pick to change.
 */
const SUGGESTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  nebius: { scout: NEMOTRON_TEXT_MODEL, ink: NEMOTRON_TEXT_MODEL, bolt: NEMOTRON_VISION_MODEL },
  openrouter: {
    scout: INK_MODEL,
    ink: INK_MODEL,
    bolt: 'anthropic/claude-haiku-4.5',
  },
  anthropic: { scout: 'claude-sonnet-5', ink: 'claude-sonnet-5', bolt: 'claude-haiku-4-5' },
  fake: { scout: 'fake-model', ink: 'fake-model', bolt: 'fake-model' },
};

/** A copy, so a renderer that mutates what it was sent cannot change the next answer. */
export function crewSuggestions(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(SUGGESTIONS).map(([providerId, models]) => [providerId, { ...models }]),
  );
}

/**
 * A pet moved onto the brain the wizard picked for it.
 *
 * Only the brain changes; who the pet is survives. The vision model follows the provider:
 * a text-only Nemotron pick gets Nemotron Nano 2 VL so a screenshot still reaches a model
 * that can see it, while Claude sees on its own and must not inherit a Token Factory id
 * it cannot route to. A watch model is dropped when the provider changes for the same
 * reason; the provider's own default takes over.
 */
export function applyCrewChoice(pet: Pet, choice: CrewChoice): Pet {
  const providerId = choice.providerId.trim();
  const model = choice.model.trim();
  if (!(WIZARD_PROVIDERS as readonly string[]).includes(providerId)) {
    throw new Error(`The setup wizard does not offer the provider '${providerId}'.`);
  }
  if (model.length === 0) throw new Error(`${pet.name} needs a model id.`);

  const { visionModel: _vision, watchModel, ...rest } = pet;
  const needsVision = providerId === 'nebius' && !NEBIUS_VISION_MODELS.includes(model);
  const keepWatch = watchModel !== undefined && providerId === pet.providerId;
  return Pet.parse({
    ...rest,
    providerId,
    model,
    ...(needsVision ? { visionModel: NEMOTRON_VISION_MODEL } : {}),
    ...(keepWatch ? { watchModel } : {}),
  });
}
