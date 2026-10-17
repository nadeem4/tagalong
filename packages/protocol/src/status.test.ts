/** Tests for the status wording table: every mark has neutral words, and the order covers them. */
import { describe, expect, it } from 'vitest';
import { STATUS_ORDER, STATUS_WORDS, StatusId, isProblem, topStatus } from './status';

describe('STATUS_WORDS', () => {
  it('gives every status a short tag and a sentence', () => {
    for (const id of StatusId.options) {
      const words = STATUS_WORDS[id];
      expect(words.tag.split(' ').length).toBeLessThanOrEqual(2);
      expect(words.detail).toMatch(/\.$/);
    }
  });

  it('never speaks as Scout: no first-person words', () => {
    for (const id of StatusId.options) {
      for (const text of [STATUS_WORDS[id].tag, STATUS_WORDS[id].detail]) {
        expect(text).not.toMatch(/^I\s|\bI’|\bI'|\bmy\b|\bme\b/i);
      }
    }
  });

  it('sends the brain marks to the brain fix', () => {
    expect(STATUS_WORDS['brain-signed-out']).toEqual({
      tag: 'Signed out',
      detail: 'Can’t think: signed out of Claude.',
      fix: 'brain',
    });
    expect(STATUS_WORDS['brain-no-key'].fix).toBe('brain');
    expect(STATUS_WORDS['listening-on'].fix).toBeUndefined();
  });
});

describe('STATUS_ORDER', () => {
  it('lists every status exactly once', () => {
    expect([...STATUS_ORDER].sort()).toEqual([...StatusId.options].sort());
  });

  it('puts problems before progress and hints', () => {
    const last = STATUS_ORDER.findLastIndex((id) => isProblem(id));
    const first = STATUS_ORDER.findIndex((id) => !isProblem(id));
    expect(last).toBeLessThan(first);
  });
});

describe('topStatus', () => {
  it('picks the first mark in the order, or null', () => {
    expect(topStatus([])).toBeNull();
    expect(topStatus([{ id: 'listening-on' }, { id: 'brain-no-key' }])).toEqual({
      id: 'brain-no-key',
    });
  });
});

describe('isProblem', () => {
  it('is true for the brain, ears and mic failures only', () => {
    expect(isProblem('brain-signed-out')).toBe(true);
    expect(isProblem('ears-failed')).toBe(true);
    expect(isProblem('mic-busy')).toBe(true);
    expect(isProblem('ears-loading')).toBe(false);
    expect(isProblem('listening-on')).toBe(false);
    expect(isProblem('declined')).toBe(false);
  });
});
