import { describe, expect, it } from 'vitest';
import { Role } from './roles';

const valid = {
  id: 'companion',
  name: 'Companion',
  version: 1,
  summary: 'Briefs the right expert.',
  goodAt: ['writing a clear brief'],
  notFor: ['doing the work itself'],
  tools: ['look_at_screen', 'remember'],
  model: { tier: 'fast', needsVision: false },
  instructions: 'You are a companion.',
};

describe('Role', () => {
  it('parses a complete role', () => {
    expect(Role.parse(valid)).toEqual(valid);
  });

  it('rejects an id that is not kebab-case', () => {
    expect(Role.safeParse({ ...valid, id: 'Big_Companion' }).success).toBe(false);
    expect(Role.safeParse({ ...valid, id: '-companion' }).success).toBe(false);
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
