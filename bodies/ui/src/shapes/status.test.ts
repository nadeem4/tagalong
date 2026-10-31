/** Tests for the status wording table: neutral words for every mark, and the top mark. */
import { describe, expect, it } from 'vitest';
import { STATUS_WORDS, StatusId, statusTag, topStatus } from './status';

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

  it('has no sign-in marks: the brain owns its own login; the only key mark is no-key', () => {
    expect(StatusId.options.filter((id) => /sign|key/.test(id))).toEqual(['no-key']);
    expect(STATUS_WORDS['no-key']).toEqual({
      tag: 'Add key',
      detail: 'Add your Anthropic key to start.',
      fix: 'key',
    });
    expect(STATUS_WORDS['listening-on'].fix).toBeUndefined();
  });

  it('words the brain being down or too new, without a fix', () => {
    expect(STATUS_WORDS['brain-offline'].detail).toBe("Scout's brain is not running.");
    expect(STATUS_WORDS['brain-outdated'].detail).toBe('Update Tagalong to talk to this brain.');
    expect(STATUS_WORDS['brain-offline'].fix).toBeUndefined();
    expect(STATUS_WORDS['brain-outdated'].fix).toBeUndefined();
  });

  it('sends the ears and mic problems to the voice fix, and keeps progress and hints muted', () => {
    for (const id of ['ears-failed', 'mic-busy', 'mic-failed'] as const) {
      expect(STATUS_WORDS[id].fix).toBe('voice');
    }
    for (const id of ['ears-loading', 'listening-paused', 'say-name'] as const) {
      expect(STATUS_WORDS[id].fix).toBeUndefined();
    }
    expect(STATUS_WORDS['say-name'].tag).toBe('Say “Scout”');
  });
});

describe('statusTag', () => {
  it('adds a download percent to the tag, rounded', () => {
    expect(statusTag({ id: 'ears-loading', percent: 39.6 })).toBe('Ears 40%');
    expect(statusTag({ id: 'ears-loading' })).toBe('Ears');
    expect(statusTag({ id: 'mic-busy' })).toBe('Mic busy');
  });
});

describe('topStatus', () => {
  it('picks the first mark in the order, or null', () => {
    expect(topStatus([])).toBeNull();
    expect(topStatus([{ id: 'listening-on' }, { id: 'mic-busy' }])).toEqual({
      id: 'mic-busy',
    });
    expect(topStatus([{ id: 'mic-busy' }, { id: 'brain-offline' }])).toEqual({
      id: 'brain-offline',
    });
  });

  it('puts problems before progress, a pause before the hints, and Listening last', () => {
    expect(StatusId.options).toEqual([
      'brain-offline',
      'brain-outdated',
      'no-key',
      'ears-failed',
      'mic-busy',
      'mic-failed',
      'ears-loading',
      'listening-paused',
      'say-name',
      'listening-on',
    ]);
  });
});
