import { describe, expect, it } from 'vitest';
import {
  Role,
  RolesListParams,
  RolesListResult,
  RolesRecommendModelParams,
  RolesRecommendModelResult,
} from './roles';

const valid = {
  id: 'backend-engineer',
  name: 'Backend engineer',
  version: 1,
  summary: 'Fixes servers, databases and broken builds.',
  goodAt: ['APIs', 'databases'],
  notFor: ['visual design'],
  tools: ['look_at_screen', 'remember'],
  model: { tier: 'deep', needsVision: false },
  instructions: 'You are a backend engineer.',
};

describe('Role', () => {
  it('parses a complete role', () => {
    expect(Role.parse(valid)).toEqual(valid);
  });

  it('rejects an id that is not kebab-case', () => {
    expect(Role.safeParse({ ...valid, id: 'Backend_Engineer' }).success).toBe(false);
    expect(Role.safeParse({ ...valid, id: '-backend' }).success).toBe(false);
  });

  it('rejects a version that is not a positive integer', () => {
    expect(Role.safeParse({ ...valid, version: 0 }).success).toBe(false);
    expect(Role.safeParse({ ...valid, version: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown model tier', () => {
    expect(Role.safeParse({ ...valid, model: { tier: 'huge', needsVision: false } }).success).toBe(
      false,
    );
  });

  it('rejects a role with no instructions', () => {
    expect(Role.safeParse({ ...valid, instructions: '' }).success).toBe(false);
  });

  it('rejects a missing vision flag', () => {
    expect(Role.safeParse({ ...valid, model: { tier: 'deep' } }).success).toBe(false);
  });
});

describe('roles.list', () => {
  it('takes no params and returns whole roles', () => {
    expect(RolesListParams.parse({})).toEqual({});
    expect(RolesListResult.parse({ roles: [valid] })).toEqual({ roles: [valid] });
  });

  it('rejects a result whose role is malformed', () => {
    expect(RolesListResult.safeParse({ roles: [{ ...valid, version: 0 }] }).success).toBe(false);
  });
});

describe('roles.recommendModel', () => {
  it('names a role and a provider', () => {
    const params = { roleId: 'writer', providerId: 'openrouter' };
    expect(RolesRecommendModelParams.parse(params)).toEqual(params);
    expect(RolesRecommendModelParams.safeParse({ roleId: '', providerId: 'x' }).success).toBe(
      false,
    );
    expect(RolesRecommendModelParams.safeParse({ roleId: 'writer' }).success).toBe(false);
  });

  it('answers with a model and a vision model, or neither for a provider with no tiers', () => {
    const both = { model: 'nemotron', visionModel: 'nemotron-vl' };
    expect(RolesRecommendModelResult.parse(both)).toEqual(both);
    expect(RolesRecommendModelResult.parse({})).toEqual({});
  });
});
