/**
 * Tagalong's built-in expert catalog: ready-made experts that reuse what the person already
 * has in Claude Code, its plugins and its connectors. No server, no fetching: the entries
 * ship in `catalog.json` and are checked here when the engine loads. The app tool names
 * live only in that file. Contains CATALOG, catalogEntry, catalogStatus, catalogBundle and
 * fromCatalog.
 */
import { CatalogEntry, type CatalogStatus, type Expert } from '@tagalong/protocol';
import raw from './catalog.json' with { type: 'json' };

/** Checks the raw catalog.json entries against the protocol schema. */
export function loadCatalog(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) throw new Error('the expert catalog is not a list');
  return value.map((entry) => CatalogEntry.parse(entry));
}

export const CATALOG: readonly CatalogEntry[] = loadCatalog(raw);

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

/**
 * What this computer has for an entry: each plugin installed or missing, each app set up in
 * Claude Code or not. An app served by a plugin (`plugin:<name>:…`) is set up once one of
 * the entry's plugins with that name is installed.
 */
export function catalogStatus(
  entry: CatalogEntry,
  have: { plugins: readonly string[]; apps: readonly string[] },
): CatalogStatus {
  const plugins = entry.plugins.map((plugin) => ({
    ...plugin,
    installed: have.plugins.includes(plugin.id),
  }));
  const apps = entry.apps.map((app) => {
    const fromPlugin = /^plugin:([^:]+):/.exec(app.server)?.[1]?.toLowerCase();
    const found =
      fromPlugin === undefined
        ? have.apps.includes(app.server)
        : plugins.some((p) => p.installed && p.id.split('@')[0]?.toLowerCase() === fromPlugin);
    return { name: app.name, found, optional: app.optional };
  });
  return { entry, plugins, apps };
}

/** What a catalog expert runs with: its plugins, its app tools and where it works. */
export interface CatalogBundle {
  plugins: string[];
  mcpTools: string[];
  workspace: 'project' | 'own';
}

/**
 * The bundle an expert runs with, read from the catalog by its `catalogId` and never from
 * what its saved row holds, so a row edited by hand cannot add a plugin or an app tool.
 * Undefined, so the run stays sealed, for every expert not installed from the catalog.
 */
export function catalogBundle(expert: Expert): CatalogBundle | undefined {
  const entry = expert.catalogId === undefined ? undefined : catalogEntry(expert.catalogId);
  if (entry === undefined) return undefined;
  return {
    plugins: entry.plugins.map((plugin) => plugin.id),
    mcpTools: entry.apps.flatMap((app) => app.tools),
    workspace: entry.workspace,
  };
}

/**
 * The expert as it is saved: only one installed from the catalog keeps a bundle, and that
 * bundle is always its entry's, whatever was sent. Every other expert stays sealed.
 */
export function fromCatalog(expert: Expert): Expert {
  if (expert.catalogId === undefined) {
    return { ...expert, connection: { ...expert.connection, plugins: [], mcpTools: [] } };
  }
  const bundle = catalogBundle(expert);
  if (bundle === undefined) {
    throw new Error(`'${expert.catalogId}' is not in the expert catalog`);
  }
  return { ...expert, connection: { ...expert.connection, ...bundle } };
}
