/** Tests for the experience log schemas and the experience.list and experience.get methods. */
import { describe, expect, it } from 'vitest';
import {
  Episode,
  EpisodeEvent,
  ExperienceGetParams,
  ExperienceGetResult,
  ExperienceListParams,
  ExperienceListResult,
} from './experience';
import { hostToCoreMethods } from './methods';

const T1 = '10000000-0000-4000-8000-000000000001';

const checkIn = {
  id: 'e1',
  mode: 'check-in',
  trigger: 'trouble',
  petId: 'scout',
  ref: T1,
  input: 'Why you woke: an error in the terminal.',
  decision: 'quiet',
  startedAt: '2026-10-19T10:00:00.000Z',
  endedAt: '2026-10-19T10:00:02.000Z',
};

describe('Episode', () => {
  it('takes a check-in that stayed quiet', () => {
    expect(Episode.parse(checkIn)).toEqual(checkIn);
  });

  it('takes a turn still running, with no decision yet', () => {
    const running = {
      id: 'e2',
      mode: 'turn',
      trigger: 'asked',
      petId: 'scout',
      startedAt: checkIn.startedAt,
    };
    expect(Episode.parse(running)).toEqual(running);
  });

  it('refuses a mode or decision the engine does not record', () => {
    expect(Episode.safeParse({ ...checkIn, mode: 'dream' }).success).toBe(false);
    expect(Episode.safeParse({ ...checkIn, decision: 'maybe' }).success).toBe(false);
  });
});

describe('EpisodeEvent', () => {
  it('takes a tool step and an outcome', () => {
    const step = {
      kind: 'step',
      name: 'look_at_screen',
      input: '{}',
      result: '1 image',
      ok: true,
      at: checkIn.startedAt,
    };
    const outcome = { kind: 'outcome', name: 'not-now', at: checkIn.endedAt };
    expect(EpisodeEvent.parse(step)).toEqual(step);
    expect(EpisodeEvent.parse(outcome)).toEqual(outcome);
  });
});

describe('experience.list and experience.get', () => {
  it('page newest first, thirty at a time by default', () => {
    expect(ExperienceListParams.parse({})).toEqual({ limit: 30 });
    expect(ExperienceListParams.safeParse({ limit: 101 }).success).toBe(false);
    expect(ExperienceListResult.parse({ episodes: [checkIn], next: 'e0' })).toEqual({
      episodes: [checkIn],
      next: 'e0',
    });
  });

  it('get one episode with its events, or null when it is gone', () => {
    expect(ExperienceGetParams.parse({ id: 'e1' })).toEqual({ id: 'e1' });
    expect(ExperienceGetResult.parse(null)).toBeNull();
    expect(ExperienceGetResult.parse({ episode: checkIn, events: [] })).toEqual({
      episode: checkIn,
      events: [],
    });
  });

  it('are host-to-core methods', () => {
    expect(hostToCoreMethods['experience.list'].params).toBe(ExperienceListParams);
    expect(hostToCoreMethods['experience.list'].result).toBe(ExperienceListResult);
    expect(hostToCoreMethods['experience.get'].params).toBe(ExperienceGetParams);
    expect(hostToCoreMethods['experience.get'].result).toBe(ExperienceGetResult);
  });
});
