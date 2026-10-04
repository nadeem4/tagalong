import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './db';
import { MemoryStore } from './memories';
import { RECALL_BUDGET_CHARS, recall, statedPreference } from './recall';

let dir: string;
let db: Database;
let memories: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-recall-'));
  db = openDatabase(dir);
  memories = new MemoryStore(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('recall', () => {
  it('returns the five most recent memories, then up to five matches not already listed', () => {
    for (let i = 0; i < 6; i += 1) {
      memories.add({ scope: 'pet', petId: 'scout', kind: 'fact', text: `old giraffe ${i}` });
    }
    for (let i = 0; i < 5; i += 1) {
      memories.add({ scope: 'pet', petId: 'scout', kind: 'fact', text: `recent note ${i}` });
    }

    const recalled = recall(memories, 'scout', 'tell me about giraffe').map((m) => m.text);

    expect(recalled.slice(0, 5)).toEqual([
      'recent note 4',
      'recent note 3',
      'recent note 2',
      'recent note 1',
      'recent note 0',
    ]);
    expect(recalled.slice(5)).toHaveLength(5);
    expect(recalled.slice(5).every((text) => text.startsWith('old giraffe'))).toBe(true);
  });

  it('does not list a recent memory twice when it also matches', () => {
    memories.add({ scope: 'pet', petId: 'scout', kind: 'preference', text: 'Short answers' });

    expect(recall(memories, 'scout', 'short answers please')).toHaveLength(1);
  });

  it('only recalls what the pet may see', () => {
    memories.add({ scope: 'pet', petId: 'ink', kind: 'fact', text: 'Ink private otter' });
    memories.add({ scope: 'crew', kind: 'fact', text: 'Shared otter' });

    expect(recall(memories, 'scout', 'otter').map((m) => m.text)).toEqual(['Shared otter']);
  });

  it('stays under the character budget, keeping the earliest-ranked memories', () => {
    for (let i = 0; i < 10; i += 1) {
      memories.add({ scope: 'pet', petId: 'scout', kind: 'fact', text: `${i} ${'x'.repeat(380)}` });
    }

    const recalled = recall(memories, 'scout', 'x');
    const total = recalled.reduce((sum, memory) => sum + memory.text.length, 0);

    expect(total).toBeLessThanOrEqual(RECALL_BUDGET_CHARS);
    expect(recalled[0]?.text.startsWith('9 ')).toBe(true);
  });
});

describe('statedPreference', () => {
  it('captures a lasting preference the user states', () => {
    expect(statedPreference('I prefer short answers.')).toBe('I prefer short answers.');
    expect(statedPreference('From now on, answer in bullet points please')).toBe(
      'From now on, answer in bullet points please',
    );
    expect(statedPreference('Explain this. Remember that I am a beginner.')).toBe(
      'Remember that I am a beginner.',
    );
  });

  it('ignores an ordinary question', () => {
    expect(statedPreference('What does this error mean?')).toBeNull();
    expect(statedPreference('Which do you prefer, tabs or spaces?')).toBeNull();
  });
});
