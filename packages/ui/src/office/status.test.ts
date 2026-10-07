import { describe, expect, it } from 'vitest';
import { NO_ACTIVITY, nextActivity, statusOf } from './status';

describe('office status', () => {
  it('starts with every pet at their desk', () => {
    expect(statusOf(NO_ACTIVITY, 'scout')).toBe('desk');
  });

  it('marks a pet working from its turn.started', () => {
    const activity = nextActivity(NO_ACTIVITY, {
      type: 'turn.started',
      turnId: 't1',
      petId: 'scout',
    });
    expect(statusOf(activity, 'scout')).toBe('working');
    expect(statusOf(activity, 'ink')).toBe('desk');
  });

  it('returns a pet to its desk when that turn completes', () => {
    const started = nextActivity(NO_ACTIVITY, {
      type: 'turn.started',
      turnId: 't1',
      petId: 'scout',
    });
    const done = nextActivity(started, { type: 'turn.completed', turnId: 't1' });
    expect(statusOf(done, 'scout')).toBe('desk');
  });

  it('returns a pet to its desk when that turn errors', () => {
    const started = nextActivity(NO_ACTIVITY, {
      type: 'turn.started',
      turnId: 't1',
      petId: 'bolt',
    });
    expect(statusOf(nextActivity(started, { type: 'turn.error', turnId: 't1' }), 'bolt')).toBe(
      'desk',
    );
  });

  it('keeps a pet working while another of its turns is still in flight', () => {
    let activity = nextActivity(NO_ACTIVITY, { type: 'turn.started', turnId: 't1', petId: 'ink' });
    activity = nextActivity(activity, { type: 'turn.started', turnId: 't2', petId: 'ink' });
    activity = nextActivity(activity, { type: 'turn.completed', turnId: 't1' });
    expect(statusOf(activity, 'ink')).toBe('working');
  });

  it('returns the same object for events that change nothing', () => {
    expect(nextActivity(NO_ACTIVITY, { type: 'turn.delta', turnId: 't1' })).toBe(NO_ACTIVITY);
    expect(nextActivity(NO_ACTIVITY, { type: 'turn.completed', turnId: 'unknown' })).toBe(
      NO_ACTIVITY,
    );
  });
});
