/** Tests for recall: which memories and recent jobs a prompt carries, within the budgets. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './db';
import { MemoryStore } from './memories';
import { RECALL_BUDGET_CHARS, RECENT_WORK_BUDGET_CHARS, recall, type RecentJob } from './recall';

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

const NOW = new Date('2026-10-17T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;

function job(id: string, task: string, note: string, daysAgo: number): RecentJob {
  return { id, task, note, finishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString() };
}

describe('recall: memories', () => {
  it('carries preferences first, then the three newest others, then matches', () => {
    memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers' });
    for (let i = 0; i < 6; i += 1) {
      memories.add({ petId: 'scout', kind: 'fact', text: `old giraffe ${i}` });
    }
    for (let i = 0; i < 6; i += 1) {
      memories.add({ petId: 'scout', kind: 'fact', text: `recent note ${i}` });
    }

    const recalled = recall(memories, 'scout', 'tell me about giraffe').memories.map((m) => m.text);

    expect(recalled.slice(0, 4)).toEqual([
      'Short answers',
      'recent note 5',
      'recent note 4',
      'recent note 3',
    ]);
    expect(recalled.slice(4)).toHaveLength(5);
    expect(recalled.slice(4).every((text) => text.startsWith('old giraffe'))).toBe(true);
  });

  it('keeps up to five preferences however many newer facts there are', () => {
    for (let i = 0; i < 6; i += 1) {
      memories.add({ petId: 'scout', kind: 'preference', text: `pref ${i}` });
    }
    for (let i = 0; i < 6; i += 1) memories.add({ petId: 'scout', kind: 'fact', text: `f ${i}` });

    const recalled = recall(memories, 'scout', '').memories.map((m) => m.text);

    expect(recalled.filter((text) => text.startsWith('pref'))).toEqual([
      'pref 5',
      'pref 4',
      'pref 3',
      'pref 2',
      'pref 1',
    ]);
    expect(recalled.filter((text) => text.startsWith('f '))).toHaveLength(3);
  });

  it('does not list a memory twice when it also matches', () => {
    memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers' });

    expect(recall(memories, 'scout', 'short answers please').memories).toHaveLength(1);
  });

  it('only recalls what the pet may see', () => {
    memories.add({ petId: 'ink', kind: 'fact', text: 'Ink private otter' });
    memories.add({ petId: 'scout', kind: 'fact', text: 'Scout otter' });

    expect(recall(memories, 'scout', 'otter').memories.map((m) => m.text)).toEqual(['Scout otter']);
  });

  it('stays under the character budget, dropping whole memories', () => {
    for (let i = 0; i < 10; i += 1) {
      memories.add({ petId: 'scout', kind: 'fact', text: `${i} ${'x'.repeat(380)}` });
    }

    const recalled = recall(memories, 'scout', 'x').memories;
    const total = recalled.reduce((sum, memory) => sum + memory.text.length, 0);

    expect(total).toBeLessThanOrEqual(RECALL_BUDGET_CHARS);
    expect(recalled[0]?.text.startsWith('9 ')).toBe(true);
  });
});

describe('recall: recent work', () => {
  it('adds up to two finished jobs that share words with the question, best match first', () => {
    const jobs = [
      job('1b2c0000-0000-0000-0000-000000000000', 'summarise the launch thread', 'Friday.', 3),
      job('2c3d0000-0000-0000-0000-000000000000', 'read the launch plan', 'Two weeks.', 1),
      job('3d4e0000-0000-0000-0000-000000000000', 'compare launch thread replies', 'Sam.', 0),
      job('4e5f0000-0000-0000-0000-000000000000', 'pricing pages', 'Cheaper.', 0),
    ];

    const { recentWork } = recall(memories, 'scout', 'what did the launch thread say?', {
      jobs,
      now: NOW,
    });

    // Three shared words beat two; between two-word matches the newer wins.
    expect(recentWork).toEqual([
      '- (your job, 3 days ago, j-1b2c) "summarise the launch thread": Friday.',
      '- (your job, today, j-3d4e) "compare launch thread replies": Sam.',
    ]);
  });

  it('leaves out jobs older than 14 days and those that match nothing', () => {
    const jobs = [
      job('1b2c0000-0000-0000-0000-000000000000', 'launch thread', 'Old.', 15),
      job('2c3d0000-0000-0000-0000-000000000000', 'pricing pages', 'Cheaper.', 1),
    ];

    expect(recall(memories, 'scout', 'launch thread', { jobs, now: NOW }).recentWork).toEqual([]);
    expect(recall(memories, 'scout', 'launch', { jobs: [], now: NOW }).recentWork).toEqual([]);
    expect(recall(memories, 'scout', 'launch').recentWork).toEqual([]);
  });

  it('keeps the recent work within its own budget', () => {
    const long = 'n'.repeat(300);
    const jobs = [
      job('1b2c0000-0000-0000-0000-000000000000', 'launch thread', long, 1),
      job('2c3d0000-0000-0000-0000-000000000000', 'launch thread again', long, 2),
    ];

    const { recentWork } = recall(memories, 'scout', 'launch thread', { jobs, now: NOW });

    expect(recentWork).toHaveLength(1);
    expect(recentWork.join('\n').length).toBeLessThanOrEqual(RECENT_WORK_BUDGET_CHARS);
    expect(recentWork[0]).toContain('yesterday');
  });
});
