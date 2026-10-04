import type { Pet } from '@tagalong/protocol';
import type { ProviderChoice } from '../../shared/ipc';

/**
 * The setup wizard's decisions, apart from its rendering.
 *
 * The desktop package tests in plain Node with no DOM, and what needs testing here was
 * never the markup: it is which step comes next, when the wizard may move on, and what
 * each pet starts on.
 */

export type OnboardingStepId =
  'welcome' | 'provider' | 'crew' | 'hotkeys' | 'memory' | 'extension' | 'finish';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
}

/** The first run, end to end. Every step but the provider one can be passed untouched. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: 'welcome', title: 'Welcome to Tagalong' },
  { id: 'provider', title: 'Choose a provider' },
  { id: 'crew', title: 'Meet your crew' },
  { id: 'hotkeys', title: 'Three keys to remember' },
  { id: 'memory', title: 'Rolling memory (optional)' },
  { id: 'extension', title: 'Chrome extension (optional)' },
  { id: 'finish', title: 'You are set' },
];

/** What the provider step tells a person about each service. */
export interface WizardProvider {
  id: 'openrouter' | 'nebius' | 'anthropic';
  label: string;
  /** One line on what the crew runs on there. */
  blurb: string;
  /** Where the key is made. Opened in the browser, never inside the app. */
  keyUrl: string;
}

export const WIZARD_PROVIDERS: readonly WizardProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'One key for hundreds of models. The crew starts on Claude.',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'nebius',
    label: 'Nebius Token Factory',
    blurb: 'NVIDIA Nemotron models. Nemotron Nano 2 VL reads your screenshots.',
    keyUrl: 'https://tokenfactory.nebius.com/',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude directly, with an Anthropic Console key.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
];

/** A pet's brain while the crew step is open. */
export interface CrewPick {
  providerId: string;
  model: string;
}

/**
 * The wizard providers a pet can run on right now: a key is stored, or one was typed in
 * this window and is about to be. Kept in the wizard's own order.
 */
export function keyedProviders(
  providers: readonly ProviderChoice[],
  typed: Readonly<Record<string, string>>,
): string[] {
  return WIZARD_PROVIDERS.map((provider) => provider.id).filter(
    (id) =>
      (typed[id] ?? '').trim().length > 0 ||
      providers.some((choice) => choice.id === id && choice.hasKey),
  );
}

/** Why the provider step cannot be left yet, or null when it can. */
export function providerStepProblem(
  providers: readonly ProviderChoice[],
  typed: Readonly<Record<string, string>>,
): string | null {
  if (keyedProviders(providers, typed).length > 0) return null;
  return 'Paste an API key for at least one provider, or press Skip setup to do this later in Settings.';
}

/**
 * What each pet starts on in the crew step.
 *
 * A pet already on a provider with a key keeps its model: a rerun of the wizard must not
 * quietly undo a choice made in Settings. Anything else moves to the provider the person
 * picked as their main one, on that provider's suggested model — Scout's suggestion for a
 * pet the wizard has no suggestion for.
 */
export function initialCrewPicks(
  pets: readonly Pet[],
  keyed: readonly string[],
  mainProvider: string,
  suggestions: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Record<string, CrewPick> {
  const picks: Record<string, CrewPick> = {};
  for (const pet of pets) {
    if (keyed.includes(pet.providerId)) {
      picks[pet.id] = { providerId: pet.providerId, model: pet.model };
      continue;
    }
    const forProvider = suggestions[mainProvider] ?? {};
    picks[pet.id] = {
      providerId: mainProvider,
      model: forProvider[pet.id] ?? forProvider.scout ?? pet.model,
    };
  }
  return picks;
}

/** An Electron accelerator as the keyboard in front of the person prints it. */
export function hotkeyLabel(accelerator: string, platform: string): string {
  const command = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' || part === 'CmdOrCtrl' ? command : part))
    .join(' + ');
}
