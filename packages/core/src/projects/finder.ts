/**
 * Guesses which local project a hand-off is about. Contains `ProjectMemory` (projects the
 * person confirmed, in the `projects` table), `ProjectFinder` (suggest and search), and
 * the folder helpers `defaultProjectRoots`, `listChildDirs` and `looksLikeProject`.
 * Reads folder names only, never file contents.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { ProjectCandidate } from '@tagalong/protocol';

/** How long a scan of the code folders is trusted before the next one. */
const RESCAN_MS = 10 * 60 * 1000;
/** A ceiling on the index, so a huge folder cannot make a scan slow. */
const MAX_PROJECTS = 2000;
/** Files that mark a folder as a project. */
const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];

/** The last part of a path, on either kind of separator. */
function nameOf(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .filter((part) => part !== '')
      .pop() ?? path
  );
}

/**
 * The projects the person confirmed for a hand-off, most recent first, in the `projects`
 * table. Only paths and names: nothing inside a project is read or stored.
 */
export class ProjectMemory {
  constructor(private readonly db: Database) {}

  used(path: string, at: number): void {
    this.db
      .prepare(
        `INSERT INTO projects (path, name, last_used) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET last_used = excluded.last_used`,
      )
      .run(path, nameOf(path), new Date(at).toISOString());
  }

  list(): { path: string; name: string }[] {
    return this.db
      .prepare<[], { path: string; name: string }>(
        'SELECT path, name FROM projects ORDER BY last_used DESC, rowid DESC',
      )
      .all();
  }
}

export interface ProjectFinderOptions {
  memory: ProjectMemory;
  /** The folders where code usually lives; each is looked at two levels deep. */
  roots: () => string[];
  /** A folder's child folders, or none when it cannot be read. */
  listDirs: (dir: string) => string[];
  isProject: (dir: string) => boolean;
  join?: (parent: string, child: string) => string;
  now?: () => number;
}

/**
 * Guesses which project a task is about, on this computer only. A project named in the
 * window title comes first, then the projects used before; `search` also covers every
 * project a light scan of the usual code folders found. It reads folder names, never
 * file contents, and nothing leaves the machine. The person always confirms the pick.
 */
export class ProjectFinder {
  readonly #options: ProjectFinderOptions;
  #index: { at: number; projects: { path: string; name: string }[] } | null = null;

  constructor(options: ProjectFinderOptions) {
    this.#options = options;
  }

  /** The best guesses for a window, best first. */
  suggest(windowTitle: string | undefined, limit = 4): ProjectCandidate[] {
    const remembered = this.#options.memory.list();
    const named = this.#namedIn(windowTitle, [...remembered, ...this.#found()]);
    const out: ProjectCandidate[] = named.map((p) => ({ ...p, reason: 'screen' }));
    for (const project of remembered) out.push({ ...project, reason: 'remembered' });
    return dedupe(out).slice(0, limit);
  }

  /** Projects whose name or path holds the query; the used ones first. */
  search(query: string, limit = 8): ProjectCandidate[] {
    const needle = query.trim().toLowerCase();
    const remembered = this.#options.memory.list();
    const matches = (p: { path: string; name: string }) =>
      p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle);
    const out: ProjectCandidate[] = remembered
      .filter(matches)
      .map((p) => ({ ...p, reason: 'remembered' }));
    if (needle !== '') {
      for (const p of this.#found().filter(matches)) out.push({ ...p, reason: 'found' });
    }
    return dedupe(out).slice(0, limit);
  }

  /** The person confirmed a project: it is suggested first next time. */
  remember(path: string): void {
    this.#options.memory.used(path, this.#now());
  }

  #namedIn(
    windowTitle: string | undefined,
    projects: { path: string; name: string }[],
  ): { path: string; name: string }[] {
    if (windowTitle === undefined || windowTitle.trim() === '') return [];
    const title = windowTitle.toLowerCase();
    // Editors put the folder between dashes ("file - folder - Visual Studio Code"); a name
    // can also stand alone among the words.
    const words = new Set(
      [...title.split(/\s[-—–|]\s/), ...title.split(/[\s()[\]:|]+/)].map((w) => w.trim()),
    );
    return projects.filter((p) => {
      const name = p.name.toLowerCase();
      return words.has(name) || title.includes(p.path.toLowerCase());
    });
  }

  #found(): { path: string; name: string }[] {
    const now = this.#now();
    if (this.#index !== null && now - this.#index.at < RESCAN_MS) return this.#index.projects;
    const { roots, listDirs, isProject } = this.#options;
    const join = this.#options.join ?? joinPath;
    const projects: { path: string; name: string }[] = [];
    const add = (path: string, name: string) => {
      if (projects.length < MAX_PROJECTS) projects.push({ path, name });
    };
    for (const root of roots()) {
      for (const child of listDirs(root)) {
        const path = join(root, child);
        if (isProject(path)) {
          add(path, child);
          continue;
        }
        for (const grandchild of listDirs(path)) {
          const inner = join(path, grandchild);
          if (isProject(inner)) add(inner, grandchild);
        }
      }
    }
    this.#index = { at: now, projects };
    return projects;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}

function dedupe(candidates: ProjectCandidate[]): ProjectCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The usual places code lives, on this computer. Missing ones are skipped by the scan. */
export function defaultProjectRoots(): string[] {
  const home = homedir();
  const homeRoots = ['projects', 'source/repos', 'code', 'dev', 'repos', 'src', 'Documents/GitHub'];
  const driveRoots =
    process.platform === 'win32' ? ['C:\\projects', 'C:\\code', 'D:\\projects', 'D:\\code'] : [];
  return [...homeRoots.map((dir) => joinPath(home, dir)), ...driveRoots];
}

/** Child folders, skipping hidden ones and the heavy ones no project lives in. */
export function listChildDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function looksLikeProject(dir: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(joinPath(dir, marker)));
}
