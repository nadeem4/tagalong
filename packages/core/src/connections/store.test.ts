import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Connection } from '@tagalong/protocol';
import { migrate } from '../memory/db';
import { ConnectionStore } from './store';

const notion: Connection = {
  id: 'notion',
  name: 'Notion',
  transport: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  auth: 'oauth',
  secretNames: [],
  enabled: true,
};

function store(): ConnectionStore {
  const db = new Database(':memory:');
  migrate(db);
  return new ConnectionStore(db);
}

describe('ConnectionStore', () => {
  it('keeps definitions in the order they were added, and edits in place', () => {
    const connections = store();
    connections.upsert(notion);
    connections.upsert({ ...notion, id: 'files', name: 'Files' });
    connections.upsert({ ...notion, enabled: false });
    expect(connections.list().map((c) => [c.id, c.enabled])).toEqual([
      ['notion', false],
      ['files', true],
    ]);
    expect(connections.get('files')?.name).toBe('Files');
  });

  it('deletes', () => {
    const connections = store();
    connections.upsert(notion);
    expect(connections.delete('notion')).toBe(true);
    expect(connections.delete('notion')).toBe(false);
    expect(connections.get('notion')).toBeNull();
  });
});
