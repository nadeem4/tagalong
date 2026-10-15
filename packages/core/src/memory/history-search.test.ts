import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db';
import { HISTORY_HITS, HistorySearch, historyQuery } from './history-search';
import { SightLog } from './sight-log';

let db: Database.Database;
let now: Date;
let days: number;

function sightLog(): SightLog {
  return new SightLog(db, {
    days: () => days,
    exclusions: () => ({ processNames: [], titlePatterns: [] }),
    now: () => now,
  });
}

function history(): HistorySearch {
  return new HistorySearch(db, { days: () => days, now: () => now });
}

function look(at: string, app: string, title?: string): void {
  now = new Date(at);
  sightLog().record({ kind: 'read_text', app, ...(title === undefined ? {} : { title }) });
}

let activityId = 0;
function activity(at: string, kind: string, text: string, turnId?: string): string {
  activityId += 1;
  const id = `a${activityId}`;
  db.prepare(
    `INSERT INTO activity (id, kind, state, pet_id, turn_id, text, expert_name, started_at)
     VALUES (?, ?, 'done', 'scout', ?, ?, ?, ?)`,
  ).run(id, kind, turnId ?? null, text, kind === 'expert' ? 'Claude Code' : null, at);
  return id;
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  now = new Date('2026-10-15T09:00:00.000Z');
  days = 7;
});

afterEach(() => db.close());

describe('historyQuery', () => {
  it('quotes every word so FTS5 syntax in a question can neither fail nor inject', () => {
    expect(historyQuery('vector "databases')).toBe('"vector" "databases"');
    expect(historyQuery('a* OR b) NEAR(x - y AND')).toBe('"or" "near" "and"');
    expect(historyQuery('title:secret')).toBe('"title" "secret"');
    expect(historyQuery('  ** "" ()  ')).toBeNull();
  });
});

describe('HistorySearch', () => {
  it('finds a window title Scout looked at, by title words or by app, with stemming', () => {
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector databases explained - Medium');
    look('2026-10-14T11:00:00.000Z', 'Code.exe', 'main.ts - tagalong');

    expect(history().search({ query: 'vector database' })).toEqual([
      {
        at: '2026-10-14T10:00:00.000Z',
        kind: 'saw',
        app: 'chrome.exe',
        text: 'Vector databases explained - Medium',
      },
    ]);
    expect(
      history()
        .search({ query: 'code' })
        .map((hit) => hit.text),
    ).toEqual(['main.ts - tagalong']);
  });

  it('needs every word to match, so one common word does not flood the answer', () => {
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector databases explained');
    look('2026-10-14T11:00:00.000Z', 'chrome.exe', 'Weather today');
    expect(history().search({ query: 'chrome vector' })).toHaveLength(1);
  });

  it('finds asks, expert briefs and routines from the activity record', () => {
    activity('2026-10-14T09:00:00.000Z', 'turn', 'what is a vector index?');
    activity('2026-10-14T09:05:00.000Z', 'expert', 'Add a vector index to search\n\nSelection: x');
    activity('2026-10-14T09:10:00.000Z', 'routine', 'Vector news digest');

    const hits = history().search({ query: 'vector' });
    expect(hits).toEqual([
      { at: '2026-10-14T09:10:00.000Z', kind: 'routine', text: 'Vector news digest' },
      {
        at: '2026-10-14T09:05:00.000Z',
        kind: 'expert',
        app: 'Claude Code',
        text: 'Add a vector index to search',
      },
      { at: '2026-10-14T09:00:00.000Z', kind: 'asked', text: 'what is a vector index?' },
    ]);
  });

  it('puts the newest first across both records and keeps at most 20', () => {
    for (let i = 0; i < 15; i += 1) {
      look(`2026-10-14T10:${String(i).padStart(2, '0')}:00.000Z`, 'chrome.exe', `Rust page ${i}`);
      activity(`2026-10-14T11:${String(i).padStart(2, '0')}:00.000Z`, 'turn', `rust question ${i}`);
    }
    const hits = history().search({ query: 'rust' });
    expect(hits).toHaveLength(HISTORY_HITS);
    expect(HISTORY_HITS).toBe(20);
    expect(hits[0]?.text).toBe('rust question 14');
    const times = hits.map((hit) => hit.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('shows a title seen many times once, at its latest look', () => {
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector databases');
    look('2026-10-14T12:00:00.000Z', 'chrome.exe', 'Vector databases');
    expect(history().search({ query: 'vector' })).toEqual([
      { at: '2026-10-14T12:00:00.000Z', kind: 'saw', app: 'chrome.exe', text: 'Vector databases' },
    ]);
  });

  it('keeps only what happened at or after since', () => {
    look('2026-10-12T10:00:00.000Z', 'chrome.exe', 'Vector one');
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector two');
    activity('2026-10-12T10:00:00.000Z', 'turn', 'vector old');
    activity('2026-10-14T11:00:00.000Z', 'turn', 'vector new');
    const hits = history().search({ query: 'vector', since: '2026-10-13T00:00:00.000Z' });
    expect(hits.map((hit) => hit.text)).toEqual(['vector new', 'Vector two']);
  });

  it('never reaches past the days the privacy log keeps, for either record', () => {
    look('2026-10-01T10:00:00.000Z', 'chrome.exe', 'Vector ancient');
    activity('2026-10-01T10:00:00.000Z', 'turn', 'vector ancient ask');
    now = new Date('2026-10-15T09:00:00.000Z');
    expect(history().search({ query: 'vector', since: '2000-01-01T00:00:00.000Z' })).toEqual([]);
  });

  it('forgets a look the person deleted, cleared or the retention pruned', () => {
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector deleted');
    look('2026-10-14T11:00:00.000Z', 'chrome.exe', 'Vector cleared');
    const log = sightLog();
    const id = log.list().find((entry) => entry.title === 'Vector deleted')?.id ?? '';
    expect(log.delete(id)).toBe(true);
    expect(history().search({ query: 'deleted' })).toEqual([]);

    log.clear();
    expect(history().search({ query: 'cleared' })).toEqual([]);

    look('2026-10-01T10:00:00.000Z', 'chrome.exe', 'Vector pruned');
    now = new Date('2026-10-15T09:00:00.000Z');
    sightLog().prune();
    days = 30; // a longer window later does not bring a pruned row back
    expect(history().search({ query: 'pruned' })).toEqual([]);
    db.exec("INSERT INTO sight_log_fts (sight_log_fts) VALUES ('integrity-check')");
  });

  it('forgets an activity row once it is deleted, and follows an edited text', () => {
    const id = activity('2026-10-14T10:00:00.000Z', 'turn', 'qdrant setup');
    db.prepare("UPDATE activity SET text = 'milvus setup' WHERE id = ?").run(id);
    expect(history().search({ query: 'qdrant' })).toEqual([]);
    expect(history().search({ query: 'milvus' })).toHaveLength(1);
    db.prepare('DELETE FROM activity WHERE id = ?').run(id);
    expect(history().search({ query: 'milvus' })).toEqual([]);
    db.exec("INSERT INTO activity_fts (activity_fts) VALUES ('integrity-check')");
  });

  it('finds a blind spot by its app only: its title was never stored', () => {
    now = new Date('2026-10-14T10:00:00.000Z');
    new SightLog(db, {
      days: () => days,
      exclusions: () => ({ processNames: ['1password.exe'], titlePatterns: [] }),
      now: () => now,
    }).record({ kind: 'read_text', app: '1password.exe', title: 'Bank vault login' });
    now = new Date('2026-10-15T09:00:00.000Z');
    expect(history().search({ query: 'bank' })).toEqual([]);
    expect(history().search({ query: '1password' })).toEqual([
      { at: '2026-10-14T10:00:00.000Z', kind: 'saw', app: '1password.exe' },
    ]);
  });

  it('leaves out the asking turn itself', () => {
    activity('2026-10-15T08:59:00.000Z', 'turn', 'what was that vector article?', 'turn-1');
    activity('2026-10-14T08:59:00.000Z', 'turn', 'vector basics', 'turn-0');
    expect(
      history()
        .search({ query: 'vector', excludeTurnId: 'turn-1' })
        .map((hit) => hit.text),
    ).toEqual(['vector basics']);
  });

  it('hides secrets and clips long text in what it returns', () => {
    const key = `sk-${'a'.repeat(30)}`;
    activity('2026-10-14T10:00:00.000Z', 'turn', `deploy with ${key} ${'x '.repeat(200)}`);
    const [hit] = history().search({ query: 'deploy' });
    expect(hit?.text).not.toContain(key);
    expect(hit?.text?.length ?? 0).toBeLessThanOrEqual(160);
  });

  it('answers nothing for a query with no words, and survives FTS5 syntax', () => {
    look('2026-10-14T10:00:00.000Z', 'chrome.exe', 'Vector databases');
    expect(history().search({ query: '"*()' })).toEqual([]);
    expect(() => history().search({ query: 'vector" OR title:* NEAR(' })).not.toThrow();
    // An operator typed by the person is just a word, never syntax.
    expect(history().search({ query: 'vector OR weather' })).toEqual([]);
  });
});
