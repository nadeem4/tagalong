/** Tests for the sight log entry and the sightLog methods. */
import { describe, expect, it } from 'vitest';
import {
  SightKind,
  SightLogClearResult,
  SightLogDeleteParams,
  SightLogEntry,
  SightLogListParams,
} from './sight-log';

describe('SightLogEntry', () => {
  it('holds metadata only: kind, where, how much and when', () => {
    const entry = SightLogEntry.parse({
      id: 'r1',
      kind: 'read_text',
      at: '2026-10-14T09:00:00.000Z',
      app: 'Code.exe',
      title: 'main.ts',
      chars: 812,
      source: 'uia',
    });
    expect(entry.chars).toBe(812);
    expect(Object.keys(SightLogEntry.shape)).not.toContain('text');
    expect(Object.keys(SightLogEntry.shape)).not.toContain('image');
  });

  it('names the kinds of looking and sending, and a settings change made by talk', () => {
    expect(SightKind.options).toEqual([
      'listed_windows',
      'read_text',
      'screenshot',
      'sent_to_ai',
      'sent_to_expert',
      'read_element_names',
      'changed_by_talk',
    ]);
  });

  it('refuses a negative count', () => {
    const at = '2026-10-14T09:00:00.000Z';
    expect(SightLogEntry.safeParse({ id: 'r', kind: 'screenshot', at, images: -1 }).success).toBe(
      false,
    );
  });
});

describe('sightLog methods', () => {
  it('lists a bounded page by default', () => {
    expect(SightLogListParams.parse({}).limit).toBe(200);
    expect(SightLogListParams.safeParse({ limit: 10_000 }).success).toBe(false);
  });

  it('deletes one row by id, and clear says how many went', () => {
    expect(SightLogDeleteParams.safeParse({}).success).toBe(false);
    expect(SightLogClearResult.parse({ deleted: 3 }).deleted).toBe(3);
  });
});
