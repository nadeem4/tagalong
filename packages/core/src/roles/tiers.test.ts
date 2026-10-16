/** Tests for MODEL_TIERS and recommendedModel: every provider covered, vision fallback. */
import type { Role } from '@tagalong/protocol';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS } from '../providers/anthropic';
import { CLAUDE_CODE_MODELS } from '../providers/claude-code-brain';
import { NEBIUS_FALLBACK_MODELS } from '../providers/nebius-models';
import { recommendedModel } from './index';
import { MODEL_TIERS } from './tiers';

const role = (tier: Role['model']['tier'], needsVision = false): Role => ({
  id: 'tester',
  name: 'Tester',
  version: 1,
  summary: 'Breaks things on purpose.',
  goodAt: [],
  notFor: [],
  tools: [],
  model: { tier, needsVision },
  instructions: 'You are a tester.',
});

describe('MODEL_TIERS', () => {
  it('covers every tier for every provider', () => {
    expect(Object.keys(MODEL_TIERS).sort()).toEqual([
      'anthropic',
      'claude-code',
      'nebius',
      'openrouter',
    ]);
    for (const tiers of Object.values(MODEL_TIERS)) {
      expect(tiers.fast).toBeTruthy();
      expect(tiers.balanced).toBeTruthy();
      expect(tiers.deep).toBeTruthy();
    }
  });

  it('names only models the providers already list', () => {
    const { anthropic, nebius } = MODEL_TIERS;
    const claudeCode = MODEL_TIERS['claude-code'];
    expect(CLAUDE_CODE_MODELS).toEqual([claudeCode?.fast, claudeCode?.balanced, claudeCode?.deep]);
    expect(ANTHROPIC_MODELS).toEqual(
      expect.arrayContaining([anthropic?.fast, anthropic?.balanced, anthropic?.deep]),
    );
    expect(NEBIUS_FALLBACK_MODELS).toEqual(
      expect.arrayContaining([nebius?.fast, nebius?.balanced, nebius?.deep, nebius?.vision]),
    );
  });
});

describe('recommendedModel', () => {
  it('picks the model for the role tier on the provider', () => {
    expect(recommendedModel(role('deep'), 'anthropic')).toEqual({ model: 'claude-opus-5' });
    expect(recommendedModel(role('fast'), 'openrouter')).toEqual({
      model: 'anthropic/claude-haiku-4.5',
    });
    expect(recommendedModel(role('balanced'), 'nebius')).toEqual({
      model: 'nvidia/nemotron-3-super-120b-a12b',
    });
  });

  it('adds a vision model when the role needs pictures and the model cannot see', () => {
    expect(recommendedModel(role('balanced', true), 'nebius')).toEqual({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      visionModel: 'nvidia/Nemotron-Nano-V2-12b',
    });
  });

  it('adds no vision model when the chosen model already sees', () => {
    expect(recommendedModel(role('balanced', true), 'anthropic')).toEqual({
      model: 'claude-sonnet-5',
    });
    expect(recommendedModel(role('balanced', true), 'openrouter')).toEqual({
      model: 'anthropic/claude-sonnet-5',
    });
  });

  it('answers undefined for a provider with no tier table', () => {
    expect(recommendedModel(role('fast'), 'fake')).toBeUndefined();
  });
});
