import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { nextPetStates, visibleCrew } from './crew';

const pet = (id: string): Pet => ({
  id,
  name: id,
  avatar: '*',
  persona: '',
  model: 'm',
  providerId: 'fake',
  toolAllowlist: [],
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

describe('nextPetStates', () => {
  it('marks the pet whose turn started as thinking, and idles it when the turn ends', () => {
    let states = nextPetStates({}, { type: 'turn.started', turnId: 't1', petId: 'ink' });
    expect(states).toEqual({ ink: 'thinking' });

    states = nextPetStates(states, { type: 'turn.started', turnId: 't2', petId: 'bolt' });
    states = nextPetStates(states, { type: 'turn.completed', turnId: 't1' });
    expect(states).toEqual({ ink: 'idle', bolt: 'thinking' });

    states = nextPetStates(states, { type: 'turn.error', turnId: 't2' });
    expect(states).toEqual({ ink: 'idle', bolt: 'idle' });
  });

  it('ignores events it does not track', () => {
    const states = { ink: 'thinking' as const };
    expect(nextPetStates(states, { type: 'turn.delta', turnId: 't1' })).toBe(states);
  });
});
