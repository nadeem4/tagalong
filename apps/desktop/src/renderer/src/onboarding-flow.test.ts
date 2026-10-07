import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import {
  ONBOARDING_STEPS,
  WIZARD_PROVIDERS,
  hotkeyLabel,
  initialCrewPicks,
  isRecommended,
  keyedProviders,
  providerStepProblem,
  recommendationsFor,
  withRecommendations,
} from './onboarding-flow';
import type { ProviderChoice } from '../../shared/ipc';

const choices = (stored: string[]): ProviderChoice[] =>
  ['openrouter', 'nebius', 'anthropic'].map((id) => ({
    id,
    label: id,
    needsKey: true,
    hasKey: stored.includes(id),
  }));

const pet = (id: string, providerId: string, model: string): Pet => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  avatar: '🔎',
  notes: 'p',
  model,
  providerId,
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text',
});

const suggestions = {
  nebius: { scout: 'nvidia/super', ink: 'nvidia/super', bolt: 'nvidia/vl' },
  openrouter: { scout: 'anthropic/claude-sonnet-5', ink: 'anthropic/claude-sonnet-5' },
};

describe('ONBOARDING_STEPS', () => {
  it('walks the first run end to end, in order', () => {
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'provider',
      'crew',
      'hotkeys',
      'memory',
      'extension',
      'finish',
    ]);
  });
});

describe('WIZARD_PROVIDERS', () => {
  it('offers OpenRouter, Token Factory and Anthropic, each with where to get a key', () => {
    expect(WIZARD_PROVIDERS.map((provider) => provider.id)).toEqual([
      'openrouter',
      'nebius',
      'anthropic',
    ]);
    for (const provider of WIZARD_PROVIDERS) expect(provider.keyUrl).toMatch(/^https:\/\//);
  });
});

describe('keyedProviders', () => {
  it('counts a stored key and a key typed in this window, and nothing else', () => {
    expect(keyedProviders(choices(['anthropic']), { nebius: 'nb-1', openrouter: '   ' })).toEqual([
      'nebius',
      'anthropic',
    ]);
  });
});

describe('providerStepProblem', () => {
  it('asks for a key when none is stored or typed', () => {
    expect(providerStepProblem(choices([]), {})).toMatch(/key/i);
  });

  it('lets a typed key through', () => {
    expect(providerStepProblem(choices([]), { openrouter: 'sk-or-1' })).toBeNull();
  });

  it('lets an already stored key through, so a rerun does not ask again', () => {
    expect(providerStepProblem(choices(['nebius']), {})).toBeNull();
  });
});

describe('initialCrewPicks', () => {
  it('keeps a pet on its provider when that provider has a key', () => {
    const picks = initialCrewPicks(
      [pet('scout', 'nebius', 'nvidia/mine')],
      ['nebius'],
      'nebius',
      suggestions,
    );
    expect(picks.scout).toEqual({ providerId: 'nebius', model: 'nvidia/mine' });
  });

  it('moves a pet without a usable key to the main provider and its suggested model', () => {
    const picks = initialCrewPicks(
      [pet('ink', 'openrouter', 'anthropic/claude-sonnet-5')],
      ['nebius'],
      'nebius',
      suggestions,
    );
    expect(picks.ink).toEqual({ providerId: 'nebius', model: 'nvidia/super' });
  });

  it("falls back to Scout's suggestion for a pet the user added", () => {
    const picks = initialCrewPicks(
      [pet('pip', 'anthropic', 'claude-opus-5')],
      ['openrouter'],
      'openrouter',
      suggestions,
    );
    expect(picks.pip).toEqual({ providerId: 'openrouter', model: 'anthropic/claude-sonnet-5' });
  });
});

describe('recommendationsFor', () => {
  it("asks for each pet's role on each keyed provider and keeps the models it gets", async () => {
    const writer = { ...pet('ink', 'nebius', 'x'), roleId: 'writer' };
    const asked: string[] = [];
    const recommended = await recommendationsFor(
      [pet('scout', 'nebius', 'x'), writer],
      ['nebius', 'anthropic'],
      (roleId, providerId) => {
        asked.push(`${roleId}@${providerId}`);
        // Token Factory knows the generalist; Anthropic answers nothing for the writer.
        if (providerId === 'anthropic' && roleId === 'writer') return Promise.resolve({});
        return Promise.resolve({ model: `${roleId}-on-${providerId}` });
      },
    );
    expect(asked.sort()).toEqual([
      'generalist@anthropic',
      'generalist@nebius',
      'writer@anthropic',
      'writer@nebius',
    ]);
    expect(recommended).toEqual({
      nebius: { scout: 'generalist-on-nebius', ink: 'writer-on-nebius' },
      anthropic: { scout: 'generalist-on-anthropic' },
    });
  });

  it('leaves out a pet whose recommendation failed, so the wizard still opens', async () => {
    const recommended = await recommendationsFor([pet('scout', 'nebius', 'x')], ['nebius'], () =>
      Promise.reject(new Error('engine down')),
    );
    expect(recommended).toEqual({ nebius: {} });
  });
});

describe('withRecommendations', () => {
  it("prefers the role's recommended model over the built-in suggestion", () => {
    const merged = withRecommendations(suggestions, { nebius: { scout: 'nvidia/role-pick' } });
    expect(merged.nebius).toEqual({
      scout: 'nvidia/role-pick',
      ink: 'nvidia/super',
      bolt: 'nvidia/vl',
    });
    expect(merged.openrouter).toEqual(suggestions.openrouter);
  });

  it('feeds initialCrewPicks, so a moved pet starts on its role model', () => {
    const merged = withRecommendations(suggestions, { nebius: { ink: 'nvidia/writer' } });
    const picks = initialCrewPicks([pet('ink', 'anthropic', 'm')], ['nebius'], 'nebius', merged);
    expect(picks.ink).toEqual({ providerId: 'nebius', model: 'nvidia/writer' });
  });
});

describe('isRecommended', () => {
  const recommended = { nebius: { ink: 'nvidia/writer' } };

  it('is true while the pick is the role model for its provider', () => {
    expect(
      isRecommended('ink', { providerId: 'nebius', model: 'nvidia/writer' }, recommended),
    ).toBe(true);
  });

  it('is false once the model is edited, or on a provider with no recommendation', () => {
    expect(isRecommended('ink', { providerId: 'nebius', model: 'nvidia/other' }, recommended)).toBe(
      false,
    );
    expect(
      isRecommended('ink', { providerId: 'anthropic', model: 'nvidia/writer' }, recommended),
    ).toBe(false);
  });
});

describe('hotkeyLabel', () => {
  it('spells CommandOrControl the way each keyboard prints it', () => {
    expect(hotkeyLabel('CommandOrControl+Shift+Space', 'win32')).toBe('Ctrl + Shift + Space');
    expect(hotkeyLabel('CommandOrControl+Shift+S', 'darwin')).toBe('Cmd + Shift + S');
    expect(hotkeyLabel('CommandOrControl+Shift+Alt+P', 'linux')).toBe('Ctrl + Shift + Alt + P');
  });
});
