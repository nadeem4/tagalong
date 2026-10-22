/**
 * The Self: Scout's own notes about the person and about itself, as plain Markdown files in
 * `<dataDir>/self`, every change kept as a version. Contains SelfStore, its pages and limits.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { hideSecrets } from '../privacy/secrets';

/** The pages every Self has, in the order they are shown. */
export const CORE_PAGES = ['you.md', 'lessons.md', 'commitments.md'] as const;
export type CorePage = (typeof CORE_PAGES)[number];

/** A skill: `skills/<lowercase-words>.md`. Nothing else can be named, so nothing else is touched. */
const SKILL_PATH = /^skills\/[a-z0-9][a-z0-9-]{0,47}\.md$/;

/** How long each page may grow: short enough to ride on every turn. */
export const PAGE_CHARS: Readonly<Record<CorePage, number>> = {
  'you.md': 6_000,
  'lessons.md': 6_000,
  'commitments.md': 3_000,
};
export const SKILL_CHARS = 4_000;
export const MAX_SKILLS = 20;
const WHY_CHARS = 300;

/** The pages Scout may change at once in a conversation; the rest it can only propose. */
const LIVE_PAGES: readonly string[] = ['you.md', 'commitments.md'];

/** Who changed a page: the person (in Home or by hand), Scout during a turn, or sleep. */
export type SelfAuthor = 'person' | 'scout' | 'sleep';

/**
 * `applied`: it was the page's text. `proposed`: a change waiting on the person. `accepted`:
 * a proposal they took, applied as a new version. `rejected`: one they turned down.
 */
export type SelfVersionState = 'applied' | 'proposed' | 'accepted' | 'rejected';

export interface SelfPageInfo {
  path: string;
  chars: number;
  updatedAt?: string | undefined;
  /** Proposed changes waiting on the person. */
  proposals: number;
}

export interface SelfVersion {
  id: number;
  path: string;
  author: SelfAuthor;
  why: string;
  /** The turn a change made during a turn came from. */
  ref?: string | undefined;
  state: SelfVersionState;
  /** Set on the version an accepted proposal became. */
  acceptedBy?: 'person' | undefined;
  text: string;
  chars: number;
  at: string;
}

export type SelfWriteResult =
  | {
      ok: true;
      versionId: number;
      /** Kept as a proposal for the person to accept or reject, not applied. */
      proposed: boolean;
      /** The person's text was longer than the page holds and was cut to fit. */
      clipped: boolean;
    }
  | { ok: false; reason: string };

export type SelfDecision = { ok: true } | { ok: false; reason: string };

interface By {
  author: SelfAuthor;
  why: string;
  ref?: string | undefined;
}

interface VersionRow {
  id: number;
  path: string;
  text: string;
  author: string;
  why: string;
  ref: string | null;
  at: string;
  state: string;
  accepted_by: string | null;
}

export function isSelfPath(path: string): boolean {
  return (CORE_PAGES as readonly string[]).includes(path) || SKILL_PATH.test(path);
}

function limitFor(path: string): number {
  return (PAGE_CHARS as Record<string, number>)[path] ?? SKILL_CHARS;
}

/** Persistent authority is the person's: sleep only proposes, and Scout proposes lessons and skills. */
function proposes(path: string, author: SelfAuthor): boolean {
  if (author === 'sleep') return true;
  return author === 'scout' && !LIVE_PAGES.includes(path);
}

/**
 * The files are the current text, so the person can read and edit them anywhere; the
 * `self_versions` table keeps every version, so the newest change can be undone and every
 * proposal waits there for the person. A file edited by hand is noticed on the next read and
 * kept as the person's version. Writes are checked by code: only the pages above, within
 * their limits, secrets hidden.
 */
export class SelfStore {
  constructor(
    private readonly db: Database.Database,
    private readonly dir: string,
  ) {}

  /** The three pages, then each skill by name, a proposed new one too so it can be reviewed. */
  list(): SelfPageInfo[] {
    const waiting = new Map<string, number>();
    for (const version of this.proposals()) {
      waiting.set(version.path, (waiting.get(version.path) ?? 0) + 1);
    }
    const proposedSkills = [...waiting.keys()].filter((path) => path.startsWith('skills/'));
    const skills = [
      ...new Set([...this.#skills().map((name) => `skills/${name}`), ...proposedSkills]),
    ].sort();
    return [...CORE_PAGES, ...skills].map((path) => {
      const text = this.#sync(path);
      const latest = this.#latest(path);
      return {
        path,
        chars: text.length,
        ...(latest === undefined ? {} : { updatedAt: latest.at }),
        proposals: waiting.get(path) ?? 0,
      };
    });
  }

  /**
   * Every page with its text, in list order: what the notes on a turn are made from. A skill
   * that is only proposed is not a page yet.
   */
  pages(): { path: string; text: string }[] {
    return this.list()
      .map((page) => ({ path: page.path, text: this.#sync(page.path) }))
      .filter((page) => !page.path.startsWith('skills/') || page.text !== '');
  }

  /** The page's text, empty when it has none yet; null for a path that is not a page. */
  read(path: string): string | null {
    if (!isSelfPath(path)) return null;
    return this.#sync(path);
  }

  /**
   * Replaces a whole page, or proposes the change when it is not the author's to make (see
   * `proposes`). Empty text deletes a skill and empties a core page. The person's own text is
   * clipped to the page's limit; Scout's and sleep's are refused over it, with the reason.
   */
  write(path: string, text: string, by: By): SelfWriteResult {
    if (!isSelfPath(path)) {
      return {
        ok: false,
        reason: `${path} is not a page. Pages: ${CORE_PAGES.join(', ')} and skills/<name>.md.`,
      };
    }
    const hidden = hideSecrets(text.replace(/\r\n/g, '\n'));
    const limit = limitFor(path);
    if (hidden.length > limit && by.author !== 'person') {
      return {
        ok: false,
        reason: `${path} holds at most ${limit} characters; this was ${hidden.length}.`,
      };
    }
    const clean = hidden.slice(0, limit);
    const clipped = clean.length < hidden.length;
    if (proposes(path, by.author)) {
      this.#sync(path);
      return {
        ok: true,
        versionId: this.#record(path, clean, by, 'proposed'),
        proposed: true,
        clipped,
      };
    }
    const applied = this.#apply(path, clean, by);
    return applied.ok ? { ...applied, proposed: false, clipped } : applied;
  }

  /** Every version of a page, newest first, proposals and all. */
  history(path: string, limit = 50): SelfVersion[] {
    if (!isSelfPath(path)) return [];
    this.#sync(path);
    return this.db
      .prepare<[string, number], VersionRow>(
        'SELECT * FROM self_versions WHERE path = ? ORDER BY id DESC LIMIT ?',
      )
      .all(path, limit)
      .map(toVersion);
  }

  /** Every proposal still waiting on the person, oldest first. */
  proposals(): SelfVersion[] {
    return this.db
      .prepare<[], VersionRow>(`SELECT * FROM self_versions WHERE state = 'proposed' ORDER BY id`)
      .all()
      .map(toVersion);
  }

  /**
   * Applies a proposal as a new version: its author and reason kept, accepted by them. One
   * written before the page last changed is refused: it is a whole page, and would undo that.
   */
  accept(versionId: number): SelfDecision {
    const row = this.#proposal(versionId);
    if (row === undefined) return { ok: false, reason: 'That change is not waiting on you.' };
    this.#sync(row.path);
    if ((this.#latest(row.path)?.id ?? 0) > versionId) {
      return {
        ok: false,
        reason: `${row.path} changed after this was proposed, and accepting it would undo that. Reject it, or edit the page yourself.`,
      };
    }
    const applied = this.#apply(row.path, row.text, toBy(row), 'person');
    if (!applied.ok) return applied;
    this.#setState(versionId, 'accepted');
    return { ok: true };
  }

  /** Turns a proposal down: kept on record as rejected, never applied. */
  reject(versionId: number): SelfDecision {
    if (this.#proposal(versionId) === undefined) {
      return { ok: false, reason: 'That change is not waiting on you.' };
    }
    this.#setState(versionId, 'rejected');
    return { ok: true };
  }

  /**
   * Restores what the page held before its newest change, as a new version of the person's.
   * Only the newest applied change can be undone; older ones are read-only.
   */
  undo(versionId: number): SelfDecision {
    const row = this.db
      .prepare<[number], VersionRow>('SELECT * FROM self_versions WHERE id = ?')
      .get(versionId);
    if (row === undefined) return { ok: false, reason: 'That change is not on record.' };
    if (row.state !== 'applied') {
      return { ok: false, reason: 'A proposed change is accepted or rejected, not undone.' };
    }
    this.#sync(row.path);
    if (this.#latest(row.path)?.id !== versionId) {
      return { ok: false, reason: 'Only the newest change to a page can be undone.' };
    }
    const before = this.db
      .prepare<[string, number], { text: string }>(
        `SELECT text FROM self_versions WHERE path = ? AND id < ? AND state = 'applied'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(row.path, versionId);
    const result = this.write(row.path, before?.text ?? '', {
      author: 'person',
      why: `Undid: ${row.why}`,
    });
    return result.ok ? { ok: true } : result;
  }

  /** Writes the file and records the version; text already clean and within its limit. */
  #apply(
    path: string,
    clean: string,
    by: By,
    acceptedBy?: 'person',
  ): { ok: true; versionId: number } | { ok: false; reason: string } {
    const file = join(this.dir, path);
    if (path.startsWith('skills/') && !existsSync(file) && clean.trim().length > 0) {
      if (this.#skills().length >= MAX_SKILLS) {
        return {
          ok: false,
          reason: `There are already ${MAX_SKILLS} skills; change or empty one first.`,
        };
      }
    }
    this.#sync(path);
    if (clean.trim().length === 0 && path.startsWith('skills/')) {
      rmSync(file, { force: true });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, clean);
    }
    return { ok: true, versionId: this.#record(path, clean, by, 'applied', acceptedBy) };
  }

  /**
   * The file's text. A file changed outside Tagalong is kept as the person's version first,
   * with secrets hidden and clipped to the page's limit like any other write, and the file is
   * put in step with what was kept.
   */
  #sync(path: string): string {
    const file = join(this.dir, path);
    const raw = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
    const recorded = this.#latest(path)?.text ?? '';
    if (raw === recorded) return raw;
    const text = hideSecrets(raw).slice(0, limitFor(path));
    if (text !== raw) writeFileSync(file, text);
    if (text !== recorded) {
      this.#record(path, text, { author: 'person', why: 'Edited outside Tagalong.' }, 'applied');
    }
    return text;
  }

  /** The page's newest applied version: what the file should hold. */
  #latest(path: string): VersionRow | undefined {
    return this.db
      .prepare<[string], VersionRow>(
        `SELECT * FROM self_versions WHERE path = ? AND state = 'applied' ORDER BY id DESC LIMIT 1`,
      )
      .get(path);
  }

  #proposal(versionId: number): VersionRow | undefined {
    return this.db
      .prepare<[number], VersionRow>(
        `SELECT * FROM self_versions WHERE id = ? AND state = 'proposed'`,
      )
      .get(versionId);
  }

  #setState(versionId: number, state: SelfVersionState): void {
    this.db.prepare('UPDATE self_versions SET state = ? WHERE id = ?').run(state, versionId);
  }

  #record(
    path: string,
    text: string,
    by: By,
    state: 'applied' | 'proposed',
    acceptedBy?: 'person',
  ): number {
    const why = hideSecrets(by.why.trim()).slice(0, WHY_CHARS) || 'No reason given.';
    return Number(
      this.db
        .prepare(
          `INSERT INTO self_versions (path, text, author, why, ref, at, state, accepted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          path,
          text,
          by.author,
          why,
          by.ref ?? null,
          new Date().toISOString(),
          state,
          acceptedBy ?? null,
        ).lastInsertRowid,
    );
  }

  /** Skill file names on disk that are valid page names, sorted. */
  #skills(): string[] {
    const dir = join(this.dir, 'skills');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => SKILL_PATH.test(`skills/${name}`))
      .sort();
  }
}

function toBy(row: VersionRow): By {
  return {
    author: row.author as SelfAuthor,
    why: row.why,
    ...(row.ref === null ? {} : { ref: row.ref }),
  };
}

function toVersion(row: VersionRow): SelfVersion {
  return {
    id: row.id,
    path: row.path,
    author: row.author as SelfAuthor,
    why: row.why,
    ...(row.ref === null ? {} : { ref: row.ref }),
    state: row.state as SelfVersionState,
    ...(row.accepted_by === 'person' ? { acceptedBy: 'person' as const } : {}),
    text: row.text,
    chars: row.text.length,
    at: row.at,
  };
}
