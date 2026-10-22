/** Tests for SelfStore: pages, limits, secrets, versions, hand edits and undo. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../memory/db';
import { MAX_SKILLS, PAGE_CHARS, SelfStore } from './store';

let dataDir: string;
let db: Database.Database;
let self: SelfStore;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-self-'));
  db = openDatabase(dataDir);
  self = new SelfStore(db, join(dataDir, 'self'));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const byScout = { author: 'scout' as const, why: 'They said so.' };
const byPerson = { author: 'person' as const, why: 'Edited in Home.' };

describe('SelfStore: pages', () => {
  it('starts with the three pages, empty', () => {
    expect(self.list().map((page) => [page.path, page.chars])).toEqual([
      ['you.md', 0],
      ['lessons.md', 0],
      ['commitments.md', 0],
    ]);
    expect(self.read('you.md')).toBe('');
  });

  it('writes a page as a plain Markdown file in the self folder', () => {
    expect(self.write('you.md', '# You\n\nWorks on Tagalong.\n', byScout)).toMatchObject({
      ok: true,
    });
    expect(readFileSync(join(dataDir, 'self', 'you.md'), 'utf8')).toBe(
      '# You\n\nWorks on Tagalong.\n',
    );
    expect(self.read('you.md')).toBe('# You\n\nWorks on Tagalong.\n');
  });

  it('keeps skills under skills/, lists them after the three, and deletes one written empty', () => {
    self.write('skills/triage-a-failing-build.md', 'Read the first error.', byPerson);
    expect(self.list().map((page) => page.path)).toEqual([
      'you.md',
      'lessons.md',
      'commitments.md',
      'skills/triage-a-failing-build.md',
    ]);
    self.write('skills/triage-a-failing-build.md', '', byPerson);
    expect(existsSync(join(dataDir, 'self', 'skills', 'triage-a-failing-build.md'))).toBe(false);
    expect(self.list()).toHaveLength(3);
  });

  it('refuses any other path, so nothing outside the folder is ever touched', () => {
    for (const path of ['../secrets.json', 'soul.md', 'skills/../you.md', 'skills/Big Name.md']) {
      expect(self.write(path, 'x', byScout)).toMatchObject({ ok: false });
      expect(self.read(path)).toBeNull();
    }
  });

  it('refuses the constitution and the soul by any path, for Scout and for sleep', () => {
    const paths = [
      'constitution.md',
      '../constitution.md',
      'soul/scout.md',
      '../soul/scout.md',
      'skills/../constitution.md',
      '..\\constitution.md',
    ];
    for (const author of ['scout', 'sleep'] as const) {
      for (const path of paths) {
        expect(self.write(path, 'Your Never list is empty.', { author, why: 'x' })).toMatchObject({
          ok: false,
        });
        expect(self.read(path)).toBeNull();
      }
    }
    for (const dir of [dataDir, join(dataDir, '..'), join(dataDir, 'self')]) {
      expect(existsSync(join(dir, 'constitution.md'))).toBe(false);
      expect(existsSync(join(dir, 'soul'))).toBe(false);
    }
  });

  it('refuses a page over its limit and says by how much', () => {
    const result = self.write('lessons.md', 'x'.repeat(PAGE_CHARS['lessons.md'] + 1), byScout);
    expect(result).toEqual({
      ok: false,
      reason: `lessons.md holds at most ${PAGE_CHARS['lessons.md']} characters; this was ${PAGE_CHARS['lessons.md'] + 1}.`,
    });
  });

  it(`holds at most ${MAX_SKILLS} skills`, () => {
    for (let i = 0; i < MAX_SKILLS; i += 1) self.write(`skills/s${i}.md`, 'step', byPerson);
    expect(self.write('skills/one-more.md', 'step', byPerson)).toMatchObject({ ok: false });
    expect(self.write('skills/s0.md', 'changed', byPerson)).toMatchObject({ ok: true });
  });

  it('hides secrets before anything is written', () => {
    self.write('you.md', 'Their key is sk-abcdefghijklmnopqrstuvwxyz0123456789', byScout);
    expect(self.read('you.md')).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('SelfStore: versions', () => {
  it('keeps every change with who made it, why, and the turn it came from', () => {
    self.write('you.md', 'Works on Tagalong.', { ...byScout, ref: 'turn-1' });
    self.write('you.md', 'Works on Tagalong. Prefers short answers.', {
      author: 'sleep',
      why: 'Three answers trimmed.',
    });
    expect(self.history('you.md')).toEqual([
      expect.objectContaining({
        author: 'sleep',
        why: 'Three answers trimmed.',
        state: 'proposed',
      }),
      expect.objectContaining({
        author: 'scout',
        why: 'They said so.',
        ref: 'turn-1',
        state: 'applied',
      }),
    ]);
  });

  it('records an edit made by hand outside Tagalong as theirs', () => {
    self.write('lessons.md', 'Lead with the gist.', byPerson);
    writeFileSync(join(dataDir, 'self', 'lessons.md'), 'Lead with the gist. Never guess a repo.');
    expect(self.read('lessons.md')).toBe('Lead with the gist. Never guess a repo.');
    expect(self.history('lessons.md')[0]).toMatchObject({ author: 'person' });
  });

  it('undoes a change by restoring what was there before it, as a new version', () => {
    self.write('you.md', 'First.', byScout);
    self.write('you.md', 'Second.', { author: 'person', why: 'Tidied.' });
    const [latest] = self.history('you.md');
    expect(self.undo(latest!.id)).toEqual({ ok: true });
    expect(self.read('you.md')).toBe('First.');
    expect(self.history('you.md')[0]).toMatchObject({ author: 'person', why: 'Undid: Tidied.' });
  });

  it('undoes the first version by emptying the page', () => {
    self.write('commitments.md', 'Follow up on the release.', byScout);
    self.undo(self.history('commitments.md')[0]!.id);
    expect(self.read('commitments.md')).toBe('');
    expect(self.undo(9_999)).toMatchObject({ ok: false });
  });
});

describe('SelfStore: proposals (persistent authority is the person’s)', () => {
  it('keeps Scout’s change to lessons.md as a proposal: not applied, not on the page', () => {
    const result = self.write('lessons.md', 'Lead with the gist.', byScout);
    expect(result).toMatchObject({ ok: true, proposed: true });
    expect(self.read('lessons.md')).toBe('');
    expect(self.pages().find((page) => page.path === 'lessons.md')?.text).toBe('');
    expect(self.history('lessons.md')[0]).toMatchObject({
      author: 'scout',
      state: 'proposed',
      text: 'Lead with the gist.',
    });
    expect(self.list().find((page) => page.path === 'lessons.md')?.proposals).toBe(1);
  });

  it('keeps a new skill from Scout as a proposal, with no file yet', () => {
    self.write('skills/triage.md', 'Read the first error.', byScout);
    expect(existsSync(join(dataDir, 'self', 'skills', 'triage.md'))).toBe(false);
    expect(self.proposals().map((version) => version.path)).toEqual(['skills/triage.md']);
  });

  it('lists a proposed new skill, so the person can open it and accept it', () => {
    const proposed = self.write('skills/triage.md', 'Read the first error.', byScout);
    if (!proposed.ok) throw new Error('not proposed');
    expect(self.list().find((page) => page.path === 'skills/triage.md')).toMatchObject({
      chars: 0,
      proposals: 1,
    });
    // Not yet a page: nothing of it rides on a turn.
    expect(self.pages().map((page) => page.path)).not.toContain('skills/triage.md');
    expect(self.accept(proposed.versionId)).toEqual({ ok: true });
    expect(self.pages().find((page) => page.path === 'skills/triage.md')?.text).toBe(
      'Read the first error.',
    );
  });

  it('keeps every change sleep makes as a proposal, even to you.md', () => {
    expect(self.write('you.md', 'Works late.', { author: 'sleep', why: 'Seen.' })).toMatchObject({
      ok: true,
      proposed: true,
    });
    expect(self.read('you.md')).toBe('');
  });

  it('applies Scout’s change to you.md and commitments.md at once', () => {
    expect(self.write('you.md', 'Works on Tagalong.', byScout)).toMatchObject({
      ok: true,
      proposed: false,
    });
    self.write('commitments.md', 'Follow up Friday.', byScout);
    expect(self.read('you.md')).toBe('Works on Tagalong.');
    expect(self.read('commitments.md')).toBe('Follow up Friday.');
  });

  it('applies an accepted proposal as a new version, author unchanged, accepted by them', () => {
    const proposed = self.write('lessons.md', 'Lead with the gist.', byScout);
    if (!proposed.ok) throw new Error('not proposed');
    expect(self.accept(proposed.versionId)).toEqual({ ok: true });
    expect(self.read('lessons.md')).toBe('Lead with the gist.');
    const [applied, original] = self.history('lessons.md');
    expect(applied).toMatchObject({ author: 'scout', state: 'applied', acceptedBy: 'person' });
    expect(original).toMatchObject({ state: 'accepted' });
    expect(self.accept(proposed.versionId)).toMatchObject({ ok: false });
  });

  it('refuses a proposal written before the page last changed, so accepting never loses that change', () => {
    const first = self.write('lessons.md', 'Lead with the gist.', byScout);
    const second = self.write('lessons.md', 'Never guess a repo.', {
      author: 'sleep',
      why: 'Seen.',
    });
    if (!first.ok || !second.ok) throw new Error('not proposed');
    expect(self.accept(second.versionId)).toEqual({ ok: true });
    expect(self.accept(first.versionId)).toMatchObject({ ok: false });
    expect(self.read('lessons.md')).toBe('Never guess a repo.');
    // Still waiting, so they can reject it.
    expect(self.reject(first.versionId)).toEqual({ ok: true });
  });

  it('keeps a rejected proposal as rejected, never on the page', () => {
    const proposed = self.write('skills/triage.md', 'Read the first error.', byScout);
    if (!proposed.ok) throw new Error('not proposed');
    expect(self.reject(proposed.versionId)).toEqual({ ok: true });
    expect(self.read('skills/triage.md')).toBe('');
    expect(self.list().map((page) => page.path)).not.toContain('skills/triage.md');
    expect(self.proposals()).toEqual([]);
    expect(self.accept(proposed.versionId)).toMatchObject({ ok: false });
  });
});

describe('SelfStore: undo and hand edits', () => {
  it('undoes only the newest applied change of a page; older ones are read-only', () => {
    self.write('you.md', 'First.', byScout);
    self.write('you.md', 'Second.', byScout);
    const [newest, older] = self.history('you.md');
    expect(self.undo(older!.id)).toEqual({
      ok: false,
      reason: 'Only the newest change to a page can be undone.',
    });
    expect(self.read('you.md')).toBe('Second.');
    expect(self.undo(newest!.id)).toEqual({ ok: true });
    expect(self.read('you.md')).toBe('First.');
  });

  it('does not undo a proposal: it is accepted or rejected', () => {
    const proposed = self.write('lessons.md', 'x', byScout);
    if (!proposed.ok) throw new Error('not proposed');
    expect(self.undo(proposed.versionId)).toMatchObject({ ok: false });
  });

  it('clips their own over-long edit instead of refusing it, and says so', () => {
    const result = self.write('commitments.md', 'c'.repeat(PAGE_CHARS['commitments.md'] + 50), {
      author: 'person',
      why: 'Edited in Home.',
    });
    expect(result).toMatchObject({ ok: true, clipped: true });
    expect(self.read('commitments.md')).toHaveLength(PAGE_CHARS['commitments.md']);
  });

  it('hides secrets in, and clips, a page edited by hand, and keeps the file in step', () => {
    const file = join(dataDir, 'self', 'you.md');
    self.write('you.md', 'Works on Tagalong.', byScout);
    writeFileSync(
      file,
      `Key sk-abcdefghijklmnopqrstuvwxyz0123456789 ${'y'.repeat(PAGE_CHARS['you.md'])}`,
    );
    const text = self.read('you.md')!;
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(text).toHaveLength(PAGE_CHARS['you.md']);
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(self.read('you.md')).toBe(text);
    expect(self.history('you.md')).toHaveLength(2);
  });

  it('undoes to an old version over today’s limit by clipping it, never failing', () => {
    self.write('commitments.md', 'Makes the folder.', byPerson);
    const long = 'o'.repeat(PAGE_CHARS['you.md'] + 10);
    const insert = db.prepare(
      `INSERT INTO self_versions (path, text, author, why, at) VALUES ('you.md', ?, 'scout', 'x', ?)`,
    );
    insert.run(long, new Date().toISOString());
    insert.run('New.', new Date().toISOString());
    writeFileSync(join(dataDir, 'self', 'you.md'), 'New.');
    expect(self.undo(self.history('you.md')[0]!.id)).toEqual({ ok: true });
    expect(self.read('you.md')).toHaveLength(PAGE_CHARS['you.md']);
  });
});
