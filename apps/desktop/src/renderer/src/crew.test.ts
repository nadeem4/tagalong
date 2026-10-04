import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import {
  nextPetStates,
  visibleCrew,
  NO_WATCH_CUES,
  clearAlert,
  isWatching,
  nextWatchCues,
} from './crew';

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

describe('nextWatchCues', () => {
  const W = '30000000-0000-4000-8000-000000000001';

  it('marks a pet as watching while any of its watches runs', () => {
    let cues = nextWatchCues(NO_WATCH_CUES, {
      type: 'watch.status',
      watchId: W,
      petId: 'scout',
      state: 'watching',
    });
    expect(isWatching(cues, 'scout')).toBe(true);
    cues = nextWatchCues(cues, {
      type: 'watch.status',
      watchId: W,
      petId: 'scout',
      state: 'stopped',
    });
    expect(isWatching(cues, 'scout')).toBe(false);
  });

  it('raises an alert on the pet whose watch fired, until it is cleared', () => {
    let cues = nextWatchCues(NO_WATCH_CUES, { type: 'watch.fired', watchId: W, petId: 'scout' });
    expect(cues.alerts).toEqual(['scout']);
    cues = clearAlert(cues, 'scout');
    expect(cues.alerts).toEqual([]);
  });

  it('ignores turn events', () => {
    expect(nextWatchCues(NO_WATCH_CUES, { type: 'turn.started', petId: 'scout' })).toBe(
      NO_WATCH_CUES,
    );
  });
});
