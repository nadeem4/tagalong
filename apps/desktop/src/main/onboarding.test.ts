import { describe, expect, it } from 'vitest';
import { Settings } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import {
  DEFAULT_CREW,
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
  WATCH_MODEL_DEFAULTS,
} from '@tagalong/core';
import { applyCrewChoice, crewSuggestions, shouldOpenOnboarding } from './onboarding';

const scout = DEFAULT_CREW.find((pet) => pet.id === 'scout')!;
const ink = DEFAULT_CREW.find((pet) => pet.id === 'ink')!;

describe('shouldOpenOnboarding', () => {
  it('opens on a fresh install', () => {
    expect(shouldOpenOnboarding(Settings.parse({}), {})).toBe(true);
  });

  it('stays shut once the wizard was finished or skipped', () => {
    expect(shouldOpenOnboarding(Settings.parse({ onboarding: { done: true } }), {})).toBe(false);
  });

  it('stays shut when the environment says to skip it, as the smoke test does', () => {
    expect(shouldOpenOnboarding(Settings.parse({}), { TAGALONG_SKIP_ONBOARDING: '1' })).toBe(false);
  });
});

describe('crewSuggestions', () => {
  it('puts the whole default crew on Nemotron when Token Factory is the pick', () => {
    const nebius = crewSuggestions().nebius!;
    expect(nebius.scout).toBe(NEMOTRON_TEXT_MODEL);
    expect(nebius.ink).toBe(NEMOTRON_TEXT_MODEL);
    expect(nebius.bolt).toBe(NEMOTRON_VISION_MODEL);
  });

  it('puts the crew on Claude through OpenRouter and through Anthropic', () => {
    const suggestions = crewSuggestions();
    expect(suggestions.openrouter!.scout).toMatch(/^anthropic\/claude-/);
    expect(suggestions.anthropic!.ink).toMatch(/^claude-/);
  });

  it('offers a suggestion for every wizard provider and every default pet', () => {
    const suggestions = crewSuggestions();
    for (const providerId of ['openrouter', 'nebius', 'anthropic', 'fake']) {
      for (const pet of DEFAULT_CREW) {
        expect(suggestions[providerId]![pet.id], `${providerId}/${pet.id}`).toBeTruthy();
      }
    }
  });
});

describe('applyCrewChoice', () => {
  it('gives a text-only Nemotron pet the Nemotron vision model, so a screenshot still lands', () => {
    const pet = applyCrewChoice(ink, { providerId: 'nebius', model: NEMOTRON_TEXT_MODEL });
    expect(pet.providerId).toBe('nebius');
    expect(pet.model).toBe(NEMOTRON_TEXT_MODEL);
    expect(pet.visionModel).toBe(NEMOTRON_VISION_MODEL);
  });

  it('needs no separate vision model when the Nemotron pick already sees', () => {
    const pet = applyCrewChoice(scout, { providerId: 'nebius', model: NEMOTRON_VISION_MODEL });
    expect(pet.visionModel).toBeUndefined();
  });

  it('drops a Token Factory vision model when the pet moves to Claude', () => {
    const pet = applyCrewChoice(scout, {
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
    });
    expect(pet.providerId).toBe('openrouter');
    expect(pet.visionModel).toBeUndefined();
  });

  it('drops a watch model that belonged to the old provider', () => {
    const watched: Pet = { ...scout, watchModel: WATCH_MODEL_DEFAULTS.nebius! };
    const pet = applyCrewChoice(watched, { providerId: 'anthropic', model: 'claude-sonnet-5' });
    expect(pet.watchModel).toBeUndefined();
  });

  it('keeps a watch model when the provider did not change', () => {
    const watched: Pet = { ...scout, watchModel: 'nvidia/custom-nano' };
    const pet = applyCrewChoice(watched, { providerId: 'nebius', model: NEMOTRON_TEXT_MODEL });
    expect(pet.watchModel).toBe('nvidia/custom-nano');
  });

  it('keeps who the pet is: name, role, notes and colour survive a brain change', () => {
    const pet = applyCrewChoice(scout, { providerId: 'anthropic', model: 'claude-sonnet-5' });
    expect(pet.name).toBe(scout.name);
    expect(pet.roleId).toBe(scout.roleId);
    expect(pet.notes).toBe(scout.notes);
    expect(pet.color).toBe(scout.color);
  });

  it('refuses a blank model with the pet named', () => {
    expect(() => applyCrewChoice(scout, { providerId: 'nebius', model: '  ' })).toThrow(/Scout/);
  });

  it('refuses a provider the wizard does not offer', () => {
    expect(() => applyCrewChoice(scout, { providerId: 'ollama', model: 'llama' })).toThrow(
      /ollama/,
    );
  });
});
