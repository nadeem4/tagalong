import { describe, expect, it } from 'vitest';
import { ActivityEntry, ActivityListParams, ActivityListResult } from './activity';
import { hostToCoreMethods } from './methods';

const T1 = '10000000-0000-4000-8000-000000000001';

const turn = {
  id: 'a1',
  kind: 'turn',
  state: 'done',
  petId: 'scout',
  turnId: T1,
  conversationId: T1,
  providerId: 'fake',
  model: 'fake-model',
  text: 'what is this error?',
  answer: 'A missing semicolon.',
  modelCalls: 2,
  startedAt: '2026-10-07T10:00:00.000Z',
  finishedAt: '2026-10-07T10:00:03.000Z',
};

describe('ActivityEntry', () => {
  it('takes a finished turn with its model and call count', () => {
    expect(ActivityEntry.parse(turn)).toEqual(turn);
  });

  it('refuses a crew-era kind: consults, handoffs and roundtables are gone', () => {
    for (const kind of ['consult', 'handoff', 'roundtable']) {
      expect(ActivityEntry.safeParse({ ...turn, kind }).success).toBe(false);
    }
  });

  it('refuses a kind the engine does not record, such as a meeting', () => {
    expect(ActivityEntry.safeParse({ ...turn, kind: 'meeting' }).success).toBe(false);
  });
});

describe('activity.list', () => {
  it('pages newest first, thirty at a time unless asked', () => {
    expect(ActivityListParams.parse({})).toEqual({ limit: 30 });
    expect(ActivityListParams.parse({ before: 'a9', limit: 5 })).toEqual({
      before: 'a9',
      limit: 5,
    });
    expect(ActivityListParams.safeParse({ limit: 0 }).success).toBe(false);
    expect(ActivityListParams.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('answers entries and the cursor for the next page, if any', () => {
    expect(ActivityListResult.parse({ entries: [turn], next: 'a1' })).toEqual({
      entries: [turn],
      next: 'a1',
    });
    expect(ActivityListResult.parse({ entries: [] })).toEqual({ entries: [] });
  });

  it('is in the host-to-core catalog', () => {
    expect(hostToCoreMethods['activity.list'].params).toBe(ActivityListParams);
    expect(hostToCoreMethods['activity.list'].result).toBe(ActivityListResult);
  });
});
