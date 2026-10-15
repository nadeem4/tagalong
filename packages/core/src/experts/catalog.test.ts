import type { Expert } from '@tagalong/protocol';
import { describe, expect, it } from 'vitest';
import raw from './catalog.json' with { type: 'json' };
import {
  CATALOG,
  catalogBundle,
  catalogEntry,
  catalogStatus,
  fromCatalog,
  loadCatalog,
} from './catalog';

describe('the built-in catalog', () => {
  it('parses, and holds the Researcher, the Trip planner and the Social media manager', () => {
    expect(loadCatalog(raw).map((entry) => entry.name)).toEqual([
      'Researcher',
      'Trip planner',
      'Social media manager',
    ]);
    expect(CATALOG).toHaveLength(3);
  });

  it('names one exact tool in every app rule, never a wildcard', () => {
    for (const entry of CATALOG) {
      for (const app of entry.apps) {
        for (const tool of app.tools) {
          expect(tool).toMatch(/^mcp__[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+$/);
          expect(tool).not.toContain('*');
        }
      }
    }
  });

  it('works in its own folder and never edits a project, so nothing is posted or booked', () => {
    for (const entry of CATALOG) {
      expect(entry.workspace).toBe('own');
      expect(entry.mayDo).not.toBe('');
    }
  });

  it('pins no skills-only plugin: the Researcher uses WebSearch and WebFetch, plus Notion', () => {
    // Firecrawl's plugin only drives its CLI through Bash, which an expert never has.
    const researcher = catalogEntry('researcher')!;
    expect(researcher.plugins.map((plugin) => plugin.id)).toEqual([
      'notion@claude-plugins-official',
    ]);
    expect(researcher.canSearchWeb).toBe(true);
  });

  it('refuses a broken catalog', () => {
    expect(() => loadCatalog([{ id: 'x' }])).toThrow();
    expect(() =>
      loadCatalog([{ ...raw[0], apps: [{ name: 'Gmail', server: 'g', tools: ['mcp__*'] }] }]),
    ).toThrow();
  });
});

describe('catalogStatus', () => {
  const researcher = catalogEntry('researcher');

  it('says which plugins are installed and which apps are set up in Claude Code', () => {
    const status = catalogStatus(researcher!, {
      plugins: ['notion@claude-plugins-official'],
      apps: [],
    });
    expect(status.plugins).toEqual([
      { id: 'notion@claude-plugins-official', name: 'Notion', installed: true },
    ]);
    // Notion's tools come with its plugin, so an installed plugin counts as set up.
    expect(status.apps).toEqual([{ name: 'Notion', found: true, optional: true }]);
  });

  it('finds a claude.ai connector by the name Claude Code gives it', () => {
    const trip = catalogEntry('trip-planner')!;
    const status = catalogStatus(trip, { plugins: [], apps: ['claude.ai Google Calendar'] });
    expect(status.apps.find((app) => app.name === 'Google Calendar')?.found).toBe(true);
    expect(status.apps.find((app) => app.name === 'Expedia')?.found).toBe(false);
  });
});

describe('fromCatalog', () => {
  const base: Expert = {
    id: 'researcher',
    name: 'My researcher',
    goodAt: '',
    enabled: true,
    instructions: '',
    connection: {
      type: 'claude-code',
      canEdit: false,
      canSearchWeb: true,
      plugins: [],
      mcpTools: [],
      workspace: 'project',
    },
  };

  it('keeps a hand-made or template expert sealed: no plugins, no apps', () => {
    const forged: Expert = {
      ...base,
      connection: {
        ...base.connection,
        plugins: ['notion@claude-plugins-official'],
        mcpTools: ['mcp__claude_ai_Gmail__send_message'],
      },
    };
    const saved = fromCatalog(forged);
    expect(saved.connection.plugins).toEqual([]);
    expect(saved.connection.mcpTools).toEqual([]);
  });

  it("gives a catalog expert exactly its entry's plugins, app tools and own folder", () => {
    const entry = catalogEntry('researcher')!;
    const saved = fromCatalog({
      ...base,
      catalogId: 'researcher',
      connection: { ...base.connection, mcpTools: ['mcp__claude_ai_Gmail__send_message'] },
    });
    expect(saved.connection.plugins).toEqual(entry.plugins.map((plugin) => plugin.id));
    expect(saved.connection.mcpTools).toEqual(entry.apps.flatMap((app) => app.tools));
    expect(saved.connection.workspace).toBe('own');
    // The person's own name and switches stay.
    expect(saved.name).toBe('My researcher');
  });

  it('refuses a catalog id that is not in the catalog', () => {
    expect(() => fromCatalog({ ...base, catalogId: 'nope' })).toThrow(/catalog/);
  });
});

describe('catalogBundle', () => {
  const stored: Expert = {
    id: 'mine',
    name: 'Mine',
    goodAt: '',
    enabled: true,
    instructions: '',
    connection: {
      type: 'claude-code',
      canEdit: true,
      canSearchWeb: false,
      // As if the saved row had been edited by hand.
      plugins: ['superpowers@claude-plugins-official'],
      mcpTools: ['mcp__claude_ai_Gmail__send_message'],
      workspace: 'project',
    },
  };

  it('gives nothing to an expert that was not installed from the catalog, whatever it stores', () => {
    expect(catalogBundle(stored)).toBeUndefined();
  });

  it('gives nothing for a stored catalog id that is not in the catalog', () => {
    expect(catalogBundle({ ...stored, catalogId: 'gmail-sender' })).toBeUndefined();
  });

  it("reads a catalog expert's bundle from the catalog, never from what it stores", () => {
    const entry = catalogEntry('researcher')!;
    expect(catalogBundle({ ...stored, catalogId: 'researcher' })).toEqual({
      plugins: entry.plugins.map((plugin) => plugin.id),
      mcpTools: entry.apps.flatMap((app) => app.tools),
      workspace: 'own',
    });
  });
});
