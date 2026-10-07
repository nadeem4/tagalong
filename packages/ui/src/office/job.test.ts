import { describe, expect, it } from 'vitest';
import type { Role } from '@tagalong/protocol';
import { jobFor } from './job';
import { officeTokens } from './tokens';

const role = (id: string, name: string): Role => ({
  id,
  name,
  version: 1,
  summary: `${name}.`,
  goodAt: ['things'],
  notFor: ['other things'],
  tools: [],
  model: { tier: 'balanced', needsVision: false },
  instructions: `You are a ${name}.`,
});

const ROLES = [
  role('generalist', 'Generalist'),
  role('writer', 'Writer'),
  role('backend-engineer', 'Backend engineer'),
  role('frontend-engineer', 'Frontend engineer'),
  role('researcher', 'Researcher'),
  role('astronaut', 'Astronaut'),
];

describe('jobFor', () => {
  it('labels a pet with its role’s name in capitals, in its class ink', () => {
    expect(jobFor('backend-engineer', ROLES)).toEqual({
      label: 'BACKEND ENGINEER',
      ink: officeTokens.roleInk['backend-engineer'],
    });
    expect(jobFor('writer', ROLES)).toEqual({ label: 'WRITER', ink: officeTokens.roleInk.writer });
  });

  it('gives every library class its own ink', () => {
    const ids = ['generalist', 'writer', 'backend-engineer', 'frontend-engineer', 'researcher'];
    for (const id of ids) {
      expect(jobFor(id, ROLES).ink).toBe(
        officeTokens.roleInk[id as keyof typeof officeTokens.roleInk],
      );
    }
  });

  it('labels a role it does not know as a generalist', () => {
    const generalist = { label: 'GENERALIST', ink: officeTokens.roleInk.generalist };
    expect(jobFor('wizard', ROLES)).toEqual(generalist);
    expect(jobFor('writer', [])).toEqual(generalist);
  });

  it('draws a class with no ink of its own in the muted text colour', () => {
    expect(jobFor('astronaut', ROLES)).toEqual({
      label: 'ASTRONAUT',
      ink: officeTokens.color.textMuted,
    });
  });
});
