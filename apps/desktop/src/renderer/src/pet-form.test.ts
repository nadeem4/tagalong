import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { buildPet } from './pet-form';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  persona: 'You explain.',
  model: 'nvidia/nemotron-3-super-120b-a12b',
  visionModel: 'nvidia/Nemotron-Nano-V2-12b',
  providerId: 'nebius',
  toolAllowlist: [],
  replyStyle: 'text',
};

describe('buildPet', () => {
  it('moves a pet to OpenRouter and Claude, dropping a vision model it no longer needs', () => {
    const pet = buildPet(scout, {
      providerId: 'openrouter',
      model: ' anthropic/claude-sonnet-5 ',
      visionModel: '',
    });
    expect(pet.providerId).toBe('openrouter');
    expect(pet.model).toBe('anthropic/claude-sonnet-5');
    expect(pet).not.toHaveProperty('visionModel');
  });

  it('keeps everything the form does not show', () => {
    const pet = buildPet(scout, { providerId: 'nebius', model: scout.model, visionModel: 'vl' });
    expect(pet.persona).toBe('You explain.');
    expect(pet.avatar).toBe('🔎');
    expect(pet.visionModel).toBe('vl');
  });

  it('refuses an empty model with a message naming the pet', () => {
    expect(() => buildPet(scout, { providerId: 'nebius', model: '  ', visionModel: '' })).toThrow(
      'Scout needs a model id.',
    );
  });

  it('refuses an empty provider', () => {
    expect(() => buildPet(scout, { providerId: '', model: 'm', visionModel: '' })).toThrow(
      'Scout needs a provider.',
    );
  });
});
