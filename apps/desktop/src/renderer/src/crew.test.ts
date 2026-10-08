import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import {
  NO_ACTIVITY,
  NO_WATCH_CUES,
  anyWatching,
  clearAlerts,
  companionFor,
  helpersOf,
  isLook,
  isWorking,
  nextActivity,
  nextWatchCues,
} from './crew';

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

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';

describe('companionFor', () => {
  it('is the default pet', () => {
    expect(companionFor(crew, 'scout')?.id).toBe('scout');
  });

  it('falls back to the first pet when the default one is gone', () => {
    expect(companionFor(crew, 'nobody')?.id).toBe('bolt');
  });

  it('is nobody when there is no crew', () => {
    expect(companionFor([], 'scout')).toBeUndefined();
  });
});

describe('nextActivity', () => {
  it('works from turn.started until that turn completes or fails', () => {
    let activity = nextActivity(NO_ACTIVITY, { type: 'turn.started', turnId: T1, petId: 'scout' });
    expect(isWorking(activity)).toBe(true);

    activity = nextActivity(activity, { type: 'turn.completed', turnId: T1 });
    expect(isWorking(activity)).toBe(false);

    activity = nextActivity(activity, { type: 'turn.started', turnId: T2, petId: 'scout' });
    activity = nextActivity(activity, { type: 'turn.error', turnId: T2 });
    expect(isWorking(activity)).toBe(false);
  });

  it('badges a consulted pet as a helper until the asking turn ends', () => {
    let activity = nextActivity(NO_ACTIVITY, { type: 'turn.started', turnId: T1, petId: 'scout' });
    activity = nextActivity(activity, {
      type: 'pet.message',
      kind: 'consult',
      turnId: T1,
      fromPetId: 'scout',
      toPetId: 'ink',
    });
    expect(helpersOf(activity, 'scout')).toEqual(['ink']);

    activity = nextActivity(activity, { type: 'turn.completed', turnId: T1 });
    expect(helpersOf(activity, 'scout')).toEqual([]);
  });

  it('counts another pet answering on its own turn as a helper, once', () => {
    let activity = nextActivity(NO_ACTIVITY, { type: 'turn.started', turnId: T1, petId: 'scout' });
    activity = nextActivity(activity, {
      type: 'pet.message',
      kind: 'consult',
      turnId: T1,
      fromPetId: 'scout',
      toPetId: 'bolt',
    });
    activity = nextActivity(activity, { type: 'turn.started', turnId: T2, petId: 'bolt' });
    expect(helpersOf(activity, 'scout')).toEqual(['bolt']);
  });

  it('never lists the companion as its own helper', () => {
    const activity = nextActivity(NO_ACTIVITY, {
      type: 'turn.started',
      turnId: T1,
      petId: 'scout',
    });
    expect(helpersOf(activity, 'scout')).toEqual([]);
  });

  it('returns the same object for events it does not track', () => {
    expect(nextActivity(NO_ACTIVITY, { type: 'turn.delta', turnId: T1 })).toBe(NO_ACTIVITY);
    expect(
      nextActivity(NO_ACTIVITY, {
        type: 'pet.message',
        kind: 'handoff',
        fromPetId: 'scout',
        toPetId: 'ink',
      }),
    ).toBe(NO_ACTIVITY);
  });
});

describe('nextWatchCues', () => {
  const W = '30000000-0000-4000-8000-000000000001';

  it('is watching while any watch of any pet runs', () => {
    let cues = nextWatchCues(NO_WATCH_CUES, {
      type: 'watch.status',
      watchId: W,
      petId: 'ink',
      state: 'watching',
    });
    expect(anyWatching(cues)).toBe(true);
    cues = nextWatchCues(cues, {
      type: 'watch.status',
      watchId: W,
      petId: 'ink',
      state: 'stopped',
    });
    expect(anyWatching(cues)).toBe(false);
  });

  it('raises an alert when a watch fired, until the pet is clicked', () => {
    let cues = nextWatchCues(NO_WATCH_CUES, { type: 'watch.fired', watchId: W, petId: 'scout' });
    expect(cues.alerts).toEqual(['scout']);
    cues = clearAlerts(cues);
    expect(cues.alerts).toEqual([]);
  });

  it('ignores turn events', () => {
    expect(nextWatchCues(NO_WATCH_CUES, { type: 'turn.started', petId: 'scout' })).toBe(
      NO_WATCH_CUES,
    );
  });
});

describe('isLook', () => {
  const at = '2026-10-07T10:00:00.000Z';

  it('is a screenshot that was taken', () => {
    expect(isLook({ at, screenshot: true, message: '' })).toBe(true);
  });

  it('is not a selection read, a refused capture or a paused one', () => {
    expect(isLook({ at, screenshot: false, message: '' })).toBe(false);
    expect(
      isLook({
        at,
        screenshot: true,
        message: '',
        blocked: { rule: 'processName', entry: 'x.exe' },
      }),
    ).toBe(false);
    expect(isLook({ at, screenshot: true, message: '', paused: true })).toBe(false);
  });
});
