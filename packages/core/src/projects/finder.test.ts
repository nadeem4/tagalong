import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { ProjectFinder, ProjectMemory } from './finder';

/** A fake disk: each folder lists its child folders; a project is one that holds `.git`. */
const DISK: Record<string, string[]> = {
  'C:\\projects': ['ai_pet', 'site', 'notes', 'clients'],
  'C:\\projects\\clients': ['acme-api'],
  'C:\\Users\\me\\source\\repos': ['ai_pet_old'],
};
const PROJECTS = new Set([
  'C:\\projects\\ai_pet',
  'C:\\projects\\site',
  'C:\\projects\\clients\\acme-api',
  'C:\\Users\\me\\source\\repos\\ai_pet_old',
]);

let db: Database.Database;
let memory: ProjectMemory;
let clock: number;

function finder(): ProjectFinder {
  return new ProjectFinder({
    memory,
    roots: () => ['C:\\projects', 'C:\\Users\\me\\source\\repos', 'C:\\missing'],
    listDirs: (dir) => DISK[dir] ?? [],
    isProject: (dir) => PROJECTS.has(dir),
    join: (a, b) => `${a}\\${b}`,
    now: () => clock,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  memory = new ProjectMemory(db);
  clock = Date.parse('2026-10-12T10:00:00Z');
});

afterEach(() => db.close());

describe('ProjectFinder.suggest', () => {
  it('puts the project named in the window title first', () => {
    expect(finder().suggest('engine.test.ts - ai_pet - Visual Studio Code')).toEqual([
      { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' },
    ]);
  });

  it('finds projects one level down, inside a group folder', () => {
    expect(finder().suggest('README.md - acme-api - Cursor')[0]).toEqual({
      name: 'acme-api',
      path: 'C:\\projects\\clients\\acme-api',
      reason: 'screen',
    });
  });

  it('follows with the projects used before, most recent first', () => {
    const projects = finder();
    projects.remember('C:\\projects\\site');
    clock += 1000;
    projects.remember('C:\\projects\\clients\\acme-api');
    expect(projects.suggest('index.ts - ai_pet - Visual Studio Code')).toEqual([
      { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' },
      { name: 'acme-api', path: 'C:\\projects\\clients\\acme-api', reason: 'remembered' },
      { name: 'site', path: 'C:\\projects\\site', reason: 'remembered' },
    ]);
  });

  it('offers what was used before when the window names no project', () => {
    const projects = finder();
    projects.remember('D:\\work\\thing');
    expect(projects.suggest('Inbox - Outlook')).toEqual([
      { name: 'thing', path: 'D:\\work\\thing', reason: 'remembered' },
    ]);
  });

  it('suggests nothing on a fresh install with nothing on screen', () => {
    expect(finder().suggest(undefined)).toEqual([]);
  });
});

describe('ProjectFinder.search', () => {
  it('matches names and paths, ignoring case, used ones first', () => {
    const projects = finder();
    projects.remember('C:\\Users\\me\\source\\repos\\ai_pet_old');
    expect(projects.search('AI_PET').map((p) => p.path)).toEqual([
      'C:\\Users\\me\\source\\repos\\ai_pet_old',
      'C:\\projects\\ai_pet',
    ]);
    expect(projects.search('clients')[0]?.reason).toBe('found');
  });

  it('lists the used projects for an empty query', () => {
    const projects = finder();
    projects.remember('C:\\projects\\site');
    expect(projects.search('  ')).toEqual([
      { name: 'site', path: 'C:\\projects\\site', reason: 'remembered' },
    ]);
  });

  it('scans once, then again only after a while', () => {
    let scans = 0;
    const projects = new ProjectFinder({
      memory,
      roots: () => ['C:\\projects'],
      listDirs: (dir) => {
        if (dir === 'C:\\projects') scans += 1;
        return DISK[dir] ?? [];
      },
      isProject: (dir) => PROJECTS.has(dir),
      join: (a, b) => `${a}\\${b}`,
      now: () => clock,
    });
    projects.search('a');
    projects.search('b');
    expect(scans).toBe(1);
    clock += 11 * 60 * 1000;
    projects.search('c');
    expect(scans).toBe(2);
  });
});
