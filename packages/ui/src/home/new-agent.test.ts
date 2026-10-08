import { describe, expect, it } from 'vitest';
import { Pet } from '@tagalong/protocol';
import type { Role } from '@tagalong/protocol';
import { newAgent } from './new-agent';

const generalist: Role = {
  id: 'generalist',
  name: 'Generalist',
  version: 3,
  summary: 'Generalist.',
  goodAt: ['things'],
  notFor: ['other things'],
  tools: [],
  model: { tier: 'balanced', needsVision: false },
  instructions: 'You are a generalist.',
};

const taken = (id: string, name: string) =>
  Pet.parse({
    id,
    name,
    avatar: '🐾',
    roleId: 'generalist',
    roleVersion: 1,
    model: 'm',
    providerId: 'fake',
  });

describe('newAgent', () => {
  it('is a generalist at the library version, on the given brain, with the base look', () => {
    const pet = newAgent({
      pets: [],
      roles: [generalist],
      providerId: 'nebius',
      model: 'nvidia/nemotron',
      visionModel: 'nvidia/vl',
    });
    expect(pet).toMatchObject({
      id: 'new-agent',
      name: 'New agent',
      roleId: 'generalist',
      roleVersion: 3,
      providerId: 'nebius',
      model: 'nvidia/nemotron',
      visionModel: 'nvidia/vl',
      toolGrants: {},
    });
    // A pet with no character of its own wears the base body, recoloured from its colour.
    expect(pet.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(Pet.safeParse(pet).success).toBe(true);
  });

  it('never reuses an id or a name already in the crew', () => {
    const pet = newAgent({
      pets: [taken('new-agent', 'New agent'), taken('new-agent-2', 'New agent 2')],
      roles: [generalist],
      providerId: 'fake',
      model: 'fake-model',
    });
    expect(pet.id).toBe('new-agent-3');
    expect(pet.name).toBe('New agent 3');
  });

  it('takes role version 1 before the library has loaded', () => {
    expect(
      newAgent({ pets: [], roles: [], providerId: 'fake', model: 'fake-model' }).roleVersion,
    ).toBe(1);
  });
});
