/** Tests for the memory entry Home lists. */
import { describe, expect, it } from 'vitest';
import { MemoryEntry } from './memory';

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

  it('carries where a profile fact came from, and who may see it', () => {
    const entry = MemoryEntry.parse({
      id: 'm1',
      kind: 'fact',
      text: 'Software engineer',
      createdAt: AT,
      tag: 'work',
      source: 'linkedin',
      sourceRef: 'cv.pdf',
      evidence: 'Software Engineer at Acme',
      visibility: 'free',
    });
    expect(entry).toMatchObject({ tag: 'work', source: 'linkedin', visibility: 'free' });
    expect(
      MemoryEntry.safeParse({
        id: 'm',
        kind: 'fact',
        text: 'x',
        createdAt: AT,
        visibility: 'secret',
      }).success,
    ).toBe(false);
  });
});
