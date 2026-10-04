import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { buildPet, newPet, petIdFor } from './pet-form';

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

describe('buildPet, the whole editor', () => {
  const full = {
    providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-5',
    visionModel: '',
    name: ' Inky ',
    avatar: '🖋️',
    persona: '  You write. ',
    color: '#A855F7',
    voiceId: '',
    replyStyle: 'voice-summary',
  };

  it('applies every field the editor shows, trimmed', () => {
    const pet = buildPet(scout, full);
    expect(pet).toMatchObject({
      id: 'scout',
      name: 'Inky',
      avatar: '🖋️',
      persona: 'You write.',
      color: '#a855f7',
      replyStyle: 'voice-summary',
    });
    expect(pet).not.toHaveProperty('voiceId');
  });

  it('keeps a voice id for Phase 3 when one is typed', () => {
    expect(buildPet(scout, { ...full, voiceId: ' rachel ' }).voiceId).toBe('rachel');
  });

  it('names the field a person must fix', () => {
    expect(() => buildPet(scout, { ...full, name: ' ' })).toThrow('Scout needs a name.');
    expect(() => buildPet(scout, { ...full, avatar: '' })).toThrow('Scout needs an emoji.');
    expect(() => buildPet(scout, { ...full, color: 'purple' })).toThrow(/colour/);
    expect(() => buildPet(scout, { ...full, replyStyle: 'loud' })).toThrow(/reply style/);
  });
});

describe('newPet', () => {
  it('starts a blank pet on the fake brain with an id that is free', () => {
    const pet = newPet(['pet', 'pet-2']);
    expect(pet.id).toBe('pet-3');
    expect(pet.providerId).toBe('fake');
    expect(pet.name).toBe('New pet');
  });
});

describe('petIdFor', () => {
  it('derives an id from the name, avoiding ids already taken', () => {
    expect(petIdFor('Sage Owl', [])).toBe('sage-owl');
    expect(petIdFor('Sage Owl', ['sage-owl'])).toBe('sage-owl-2');
    expect(petIdFor('!!!', [])).toBe('pet');
  });
});
