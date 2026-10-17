/** Tests for the memory entry and the memory.list / memory.delete methods. */
import { describe, expect, it } from 'vitest';
import {
  MemoryDeleteParams,
  MemoryDeleteResult,
  MemoryEntry,
  MemoryListParams,
  MemoryListResult,
} from './memory';

const AT = '2026-10-16T09:00:00.000Z';

describe('MemoryEntry', () => {
  it('holds the kind, the text and when it was saved', () => {
    const entry = MemoryEntry.parse({
      id: 'm1',
      kind: 'preference',
      text: 'Short answers.',
      createdAt: AT,
    });
    expect(entry).toEqual({ id: 'm1', kind: 'preference', text: 'Short answers.', createdAt: AT });
  });

  it('knows only the three kinds memory stores', () => {
    expect(MemoryEntry.shape.kind.options).toEqual(['fact', 'preference', 'summary']);
    expect(
      MemoryEntry.safeParse({ id: 'm', kind: 'secret', text: 'x', createdAt: AT }).success,
    ).toBe(false);
  });
});

describe('memory methods', () => {
  it('lists a bounded page by default, continued by before', () => {
    expect(MemoryListParams.parse({})).toEqual({ limit: 50 });
    expect(MemoryListParams.parse({ before: 'm9', limit: 10 })).toEqual({
      before: 'm9',
      limit: 10,
    });
    expect(MemoryListParams.safeParse({ limit: 500 }).success).toBe(false);
    expect(MemoryListParams.safeParse({ before: '' }).success).toBe(false);
  });

  it('says whether older memories remain', () => {
    const page = MemoryListResult.parse({ memories: [], next: 'm3' });
    expect(page.next).toBe('m3');
    expect(MemoryListResult.parse({ memories: [] }).next).toBeUndefined();
  });

  it('deletes one memory by id', () => {
    expect(MemoryDeleteParams.safeParse({}).success).toBe(false);
    expect(MemoryDeleteResult.parse({ deleted: false }).deleted).toBe(false);
  });
});
