/** Tests for RouteMemory: the user's pick wins and deleted experts are forgotten. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { RouteMemory } from './routes';

let db: Database.Database;
let routes: RouteMemory;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  routes = new RouteMemory(db);
});

afterEach(() => db.close());

describe('RouteMemory', () => {
  it('knows nothing at first', () => {
    expect(routes.get('fix-code')).toBeNull();
  });

  it('remembers which expert took a kind of task', () => {
    routes.remember('fix-code', 'claude-code', 'companion');
    expect(routes.get('fix-code')).toEqual({ expertId: 'claude-code', by: 'companion' });
  });

  it('lets the companion change its own pick', () => {
    routes.remember('fix-code', 'claude-code', 'companion');
    routes.remember('fix-code', 'gemini', 'companion');
    expect(routes.get('fix-code')?.expertId).toBe('gemini');
  });

  it('never lets the companion overwrite what the user chose', () => {
    routes.remember('fix-code', 'gemini', 'user');
    routes.remember('fix-code', 'claude-code', 'companion');
    expect(routes.get('fix-code')).toEqual({ expertId: 'gemini', by: 'user' });
    routes.remember('fix-code', 'claude-code', 'user');
    expect(routes.get('fix-code')).toEqual({ expertId: 'claude-code', by: 'user' });
  });

  it('treats task kinds without regard to case or spacing', () => {
    routes.remember(' Fix-Code ', 'claude-code', 'companion');
    expect(routes.get('fix-code')?.expertId).toBe('claude-code');
  });

  it('forgets routes to an expert that was deleted', () => {
    routes.remember('fix-code', 'claude-code', 'user');
    routes.forgetExpert('claude-code');
    expect(routes.get('fix-code')).toBeNull();
  });
});
