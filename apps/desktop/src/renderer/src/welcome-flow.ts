import type { SettingsPatch } from '@tagalong/protocol';
import type { FoundAgent, ProviderChoice } from '../../shared/ipc';
import { cleanUserName } from './settings-form';

/**
 * Welcome's decisions, apart from its rendering: the ways Scout can think, which one is
 * picked to start with, and when Start is allowed. The desktop package tests in plain
 * Node, so these live here rather than in the component.
 */

/** One way Scout can think: an agent's sign-in (no key) or a provider's API key. */
export interface BrainOption {
  id: string;
  label: string;
  /** True when Start needs a key typed first. */
  needsKey: boolean;
}

/**
 * The sign-ins of the agents found here that the companion can think through, then every
 * provider that takes a key. The fake provider is for tests and demos, never offered.
 */
export function brainOptions(
  agents: readonly FoundAgent[],
  providers: readonly ProviderChoice[],
): BrainOption[] {
  const signIns = agents
    .filter((agent) => agent.found && agent.canThink)
    .map((agent) => ({ id: agent.id, label: `${agent.label} sign-in`, needsKey: false }));
  const keyed = providers
    .filter((provider) => provider.needsKey)
    .map((provider) => ({
      id: provider.id,
      label: `${provider.label} API key`,
      needsKey: !provider.hasKey,
    }));
  return [...signIns, ...keyed];
}

/** A sign-in first, then a provider whose key is already stored, then the first provider. */
export function defaultBrain(options: readonly BrainOption[]): string | undefined {
  return (options.find((option) => !option.needsKey) ?? options[0])?.id;
}

/** The name typed in Welcome as a settings patch, or null when the field was skipped. */
export function welcomeNamePatch(typed: string): SettingsPatch | null {
  const userName = cleanUserName(typed);
  return userName === '' ? null : { userName };
}

export function canStart(options: readonly BrainOption[], id: string, typedKey: string): boolean {
  const option = options.find((candidate) => candidate.id === id);
  if (option === undefined) return false;
  return !option.needsKey || typedKey.trim().length > 0;
}
