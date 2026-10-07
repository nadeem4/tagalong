import { describe, expect, it } from 'vitest';
import { Pet } from '@tagalong/protocol';
import { buildPet, newPet, petIdFor, roleVersionFor } from './pet-form';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: 'You explain.',
  model: 'nvidia/nemotron-3-super-120b-a12b',
  visionModel: 'nvidia/Nemotron-Nano-V2-12b',
  providerId: 'nebius',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
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
    expect(pet.notes).toBe('You explain.');
    expect(pet.roleId).toBe('generalist');
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
    notes: '  You write. ',
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
      notes: 'You write.',
      color: '#a855f7',
      replyStyle: 'voice-summary',
    });
    expect(pet).not.toHaveProperty('voiceId');
  });

  it('removes the notes when they are cleared', () => {
    expect(buildPet(scout, { ...full, notes: '  ' })).not.toHaveProperty('notes');
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
    expect(pet.roleId).toBe('generalist');
    expect(pet).not.toHaveProperty('notes');
  });
});

describe('petIdFor', () => {
  it('derives an id from the name, avoiding ids already taken', () => {
    expect(petIdFor('Sage Owl', [])).toBe('sage-owl');
    expect(petIdFor('Sage Owl', ['sage-owl'])).toBe('sage-owl-2');
    expect(petIdFor('!!!', [])).toBe('pet');
  });
});

describe('buildPet watch model', () => {
  const stored = Pet.parse({
    id: 'scout',
    name: 'Scout',
    avatar: '🔎',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    providerId: 'nebius',
    roleId: 'generalist',
    roleVersion: 1,
    watchModel: 'old-check-model',
  });
  const brain = { providerId: 'nebius', model: stored.model, visionModel: '' };

  it('keeps a check model the user typed', () => {
    expect(
      buildPet(stored, { ...brain, watchModel: ' nvidia/nemotron-3-nano-30b-a3b ' }).watchModel,
    ).toBe('nvidia/nemotron-3-nano-30b-a3b');
  });

  it('a blank check model means the provider default', () => {
    expect(buildPet(stored, { ...brain, watchModel: '' }).watchModel).toBeUndefined();
  });

  it('a form that does not show the field leaves it alone', () => {
    expect(buildPet(stored, brain).watchModel).toBe('old-check-model');
  });
});

describe('buildPet role and tools', () => {
  const brain = { providerId: 'nebius', model: scout.model, visionModel: '' };

  it('applies a new role, its version and the tool grants', () => {
    const pet = buildPet(scout, {
      ...brain,
      roleId: 'backend-engineer',
      roleVersion: 2,
      toolGrants: '{"watch_for":"off","remember":"allowed"}',
    });
    expect(pet.roleId).toBe('backend-engineer');
    expect(pet.roleVersion).toBe(2);
    expect(pet.toolGrants).toEqual({ watch_for: 'off', remember: 'allowed' });
  });

  it('a form that does not show them leaves role and grants alone', () => {
    const pet = buildPet({ ...scout, toolGrants: { remember: 'off' } }, brain);
    expect(pet.roleId).toBe('generalist');
    expect(pet.toolGrants).toEqual({ remember: 'off' });
  });

  it('refuses grants that are not tool id to off or allowed', () => {
    expect(() => buildPet(scout, { ...brain, toolGrants: '{"remember":"maybe"}' })).toThrow(
      "Scout's tool switches could not be read. Reopen Settings and try again.",
    );
    expect(() => buildPet(scout, { ...brain, toolGrants: 'not json' })).toThrow(
      "Scout's tool switches",
    );
  });
});

describe('roleVersionFor', () => {
  const roles = [{ id: 'backend-engineer', version: 3 }];

  it('keeps the version the pet took its role at while the role is unchanged', () => {
    expect(roleVersionFor(scout, 'generalist', roles)).toBe(1);
  });

  it('takes the library version of a newly picked role', () => {
    expect(roleVersionFor(scout, 'backend-engineer', roles)).toBe(3);
  });

  it('falls back to 1 for a role the library does not list', () => {
    expect(roleVersionFor(scout, 'mystery', roles)).toBe(1);
  });
});
