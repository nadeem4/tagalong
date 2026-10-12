import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { visibleCrew } from './crew';

const pet = (id: string): Pet => ({
  id,
  name: id,
  avatar: '*',
  model: 'm',
  providerId: 'fake',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text',
});
const crew = [pet('bolt'), pet('ink'), pet('scout')];

describe('visibleCrew', () => {
  it('puts the default pet first and leaves out the hidden ones', () => {
    expect(visibleCrew(crew, ['ink'], 'scout').map((p) => p.id)).toEqual(['scout', 'bolt']);
  });

  it('keeps registry order when the default pet is missing', () => {
    expect(visibleCrew(crew, [], 'nobody').map((p) => p.id)).toEqual(['bolt', 'ink', 'scout']);
  });
});
