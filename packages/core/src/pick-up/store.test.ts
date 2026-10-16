/** Tests for PickUpStore: save, overwrite, clear and unreadable rows. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { PickUpStore, type PickUpSnapshot } from './store';

let db: Database.Database;
let store: PickUpStore;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  store = new PickUpStore(db);
});

afterEach(() => db.close());

const snapshot: PickUpSnapshot = {
  startedAt: Date.UTC(2026, 9, 14, 8),
  takenAt: Date.UTC(2026, 9, 14, 17, 50),
  projects: [
    {
      name: 'ai_pet',
      path: 'C:\\projects\\ai_pet',
      editor: 'vscode',
      branch: 'feat/x',
      file: 'engine.ts',
    },
  ],
  handoffs: [
    { expertId: 'claude-code', expertName: 'Claude Code', ask: 'Fix it', state: 'unsent' },
  ],
};

describe('PickUpStore', () => {
  it('has nothing before the first snapshot', () => {
    expect(store.get()).toBeNull();
  });

  it('keeps one snapshot, overwritten each time', () => {
    store.save(snapshot);
    expect(store.get()).toEqual(snapshot);
    const later = { ...snapshot, takenAt: snapshot.takenAt + 600_000, handoffs: [] };
    store.save(later);
    expect(store.get()).toEqual(later);
    const rows = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM pick_up').get();
    expect(rows?.n).toBe(1);
  });

  it('deletes it when cleared', () => {
    store.save(snapshot);
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('reads an unreadable row as no snapshot rather than failing', () => {
    db.prepare(
      "INSERT INTO pick_up (id, started_at, taken_at, json) VALUES (1, 'x', 'y', 'not json')",
    ).run();
    expect(store.get()).toBeNull();
  });
});
