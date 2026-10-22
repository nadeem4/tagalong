/** Tests for ConnectionManager against in-process servers: connect, call, failures, sign-in. */
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '@tagalong/protocol';
import { migrate } from '../memory/db';
import { InMemorySecretStore } from '../settings/settings';
import { FakeOAuthTransport, fakeMcpServer, type FakeTool } from './fake-server';
import { ConnectionManager, type ConnectionManagerOptions, type TransportFor } from './manager';
import { ConnectionStore } from './store';

const TOOLS: FakeTool[] = [
  {
    name: 'search',
    description: 'Search pages.\nLonger help that the prompt does not need.',
    annotations: { readOnlyHint: true },
    run: (args) => ({ content: [{ type: 'text', text: `Found: ${String(args['query'])}` }] }),
  },
  {
    name: 'create_page',
    description: 'Create a page.',
    run: (args) => ({ content: [{ type: 'text', text: `Created ${String(args['title'])}` }] }),
  },
  {
    name: 'slow',
    annotations: { readOnlyHint: true },
    run: () => new Promise(() => undefined),
  },
  {
    name: 'broken',
    annotations: { readOnlyHint: true },
    run: () => ({ content: [{ type: 'text', text: 'page not found' }], isError: true }),
  },
];

function setup(overrides: Partial<ConnectionManagerOptions> = {}) {
  const db = new Database(':memory:');
  migrate(db);
  const server = fakeMcpServer(TOOLS);
  const secrets = new InMemorySecretStore();
  const changes: ConnectionState[][] = [];
  const seen: Parameters<TransportFor>[1][] = [];
  const store = new ConnectionStore(db);
  const manager = new ConnectionManager({
    store,
    secrets,
    emit: (connections) => changes.push(connections),
    transportFor: async (_connection, ctx) => {
      seen.push(ctx);
      return server.transport();
    },
    callTimeoutMs: 200,
    ...overrides,
  });
  return { manager, server, secrets, changes, seen, store };
}

const notion = {
  name: 'Notion',
  transport: { type: 'http' as const, url: 'https://mcp.notion.com/mcp' },
  auth: 'none' as const,
};

describe('ConnectionManager', () => {
  it('connects, lists the tools with read or write, and tells Home', async () => {
    const { manager, changes } = setup();
    const state = await manager.add(notion);
    expect(state.id).toBe('notion');
    expect(state.status).toBe('connected');
    expect(state.tools).toEqual([
      {
        name: 'search',
        description: 'Search pages.\nLonger help that the prompt does not need.',
        access: 'read',
      },
      { name: 'create_page', description: 'Create a page.', access: 'write' },
      { name: 'slow', access: 'read' },
      { name: 'broken', access: 'read' },
    ]);
    // Scout's tools carry how much asking each write needs; Home's list does not.
    expect(manager.tools().map((t) => [t.tool.name, t.tool.risk])).toEqual([
      ['search', 'read'],
      ['create_page', 'change'],
      ['slow', 'read'],
      ['broken', 'read'],
    ]);
    expect(changes.at(-1)?.[0]?.status).toBe('connected');
  });

  it('calls a tool and answers with its text', async () => {
    const { manager, server } = setup();
    await manager.add(notion);
    const result = await manager.call('notion', 'search', { query: 'plan' });
    expect(result).toEqual({ ok: true, text: 'Found: plan' });
    expect(server.calls).toEqual([{ name: 'search', args: { query: 'plan' } }]);
  });

  it('says plainly when an app refuses, takes too long, or is not connected', async () => {
    const { manager } = setup();
    await manager.add(notion);
    expect(await manager.call('notion', 'broken', {})).toEqual({
      ok: false,
      text: 'Notion said: page not found',
    });
    expect(await manager.call('notion', 'slow', {})).toEqual({
      ok: false,
      text: 'Notion did not answer in time, so nothing came back.',
    });
    await manager.setEnabled('notion', false);
    expect(await manager.call('notion', 'search', {})).toEqual({
      ok: false,
      text: 'Notion is not connected right now. It can be reconnected in Home, Connections.',
    });
  });

  it('a switched-off connection has no tools and does not connect', async () => {
    const { manager } = setup();
    await manager.add(notion);
    const off = await manager.setEnabled('notion', false);
    expect(off.status).toBe('off');
    expect(manager.tools()).toEqual([]);
    const on = await manager.setEnabled('notion', true);
    expect(on.status).toBe('connected');
    expect(manager.tools().map((t) => t.tool.name)).toContain('search');
  });

  it('a connector that fails to start is an error with a plain message, and others still work', async () => {
    const { manager } = setup({
      transportFor: async (connection) => {
        if (connection.id === 'broken-app') throw new Error('spawn npx ENOENT');
        return fakeMcpServer(TOOLS).transport();
      },
    });
    const broken = await manager.add({
      name: 'Broken app',
      transport: { type: 'stdio', command: 'npx' },
      auth: 'none',
    });
    expect(broken.status).toBe('error');
    expect(broken.error).toBe('Could not connect to Broken app: spawn npx ENOENT');
    const ok = await manager.add(notion);
    expect(ok.status).toBe('connected');
  });

  it('keeps a pasted key in the secret store, sends it as a header, and never lists it', async () => {
    const { manager, secrets, seen } = setup();
    const state = await manager.add({ ...notion, auth: 'token', secrets: { token: 'ghp_abc' } });
    expect(await secrets.get('connection.notion.token')).toBe('ghp_abc');
    expect(seen.at(-1)?.headers).toEqual({ Authorization: 'Bearer ghp_abc' });
    expect(JSON.stringify(state)).not.toContain('ghp_abc');
    expect(JSON.stringify(manager.list())).not.toContain('ghp_abc');
  });

  it('gives a local command its secret env values from the secret store', async () => {
    const { manager, secrets, seen } = setup();
    const state = await manager.add({
      name: 'Database',
      transport: { type: 'stdio', command: 'db', env: { MODE: 'prod' } },
      auth: 'none',
      secrets: { API_KEY: 'sk-1' },
    });
    expect(state.secretNames).toEqual(['API_KEY']);
    expect(JSON.stringify(state)).not.toContain('sk-1');
    expect(await secrets.get('connection.database.env.API_KEY')).toBe('sk-1');
    expect(seen.at(-1)?.env).toEqual({ MODE: 'prod', API_KEY: 'sk-1' });
  });

  it('Disconnect closes it, deletes every key and token, and forgets it', async () => {
    const { manager, secrets } = setup();
    await manager.add({ ...notion, auth: 'token', secrets: { token: 't' } });
    await secrets.set('connection.notion.oauth', '{"tokens":{}}');
    expect(await manager.remove('notion')).toBe(true);
    expect(await secrets.get('connection.notion.token')).toBeNull();
    expect(await secrets.get('connection.notion.oauth')).toBeNull();
    expect(manager.list()).toEqual([]);
  });

  it('refuses a second connection with the same id', async () => {
    const { manager } = setup();
    await manager.add({ ...notion, id: 'notion' });
    await expect(manager.add({ ...notion, id: 'notion' })).rejects.toThrow(
      'Notion is already connected.',
    );
  });

  it('start connects every switched-on connection saved before', async () => {
    const first = setup();
    await first.manager.add(notion);
    const again = new ConnectionManager({
      store: first.store,
      secrets: first.secrets,
      emit: () => undefined,
      transportFor: () => fakeMcpServer(TOOLS).transport(),
    });
    expect(again.list()[0]?.status).toBe('connecting');
    await again.start();
    expect(again.list()[0]?.status).toBe('connected');
  });
});

describe('ConnectionManager sign-in', () => {
  it('beginSignIn answers at once with connecting, and the result arrives as a change', async () => {
    const opened: string[] = [];
    const { manager, changes } = oauthSetup(browserThatSignsIn(opened));
    await manager.add({ ...notion, auth: 'oauth' });
    expect(manager.beginSignIn('notion').status).toBe('connecting');
    await vi.waitFor(() => expect(changes.at(-1)?.[0]?.status).toBe('connected'));
  });

  function oauthSetup(openBrowser?: (url: string) => void) {
    const server = fakeMcpServer(TOOLS);
    return setup({
      ...(openBrowser ? { openBrowser } : {}),
      transportFor: async (_connection, ctx) =>
        new FakeOAuthTransport(await server.transport(), ctx.authProvider!),
    });
  }

  /** What a browser does: the app sends it back to the loopback with a code. */
  function browserThatSignsIn(opened: string[]) {
    return (url: string) => {
      opened.push(url);
      const asked = new URL(url);
      const back = new URL(asked.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'abc');
      back.searchParams.set('state', asked.searchParams.get('state') ?? '');
      void fetch(back);
    };
  }

  it('opens the browser, takes the code on the loopback, and keeps the token in the secret store', async () => {
    const opened: string[] = [];
    const { manager, secrets } = oauthSetup(browserThatSignsIn(opened));
    const added = await manager.add({ ...notion, auth: 'oauth' });
    expect(added.status).toBe('needs-sign-in');
    expect(opened).toEqual([]);
    const state = await manager.signIn('notion');
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0]!).searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(state.status).toBe('connected');
    const stored = JSON.parse((await secrets.get('connection.notion.oauth'))!);
    expect(stored.tokens.access_token).toBe('token-abc');
    expect(JSON.stringify(manager.list())).not.toContain('token-abc');
  });

  it('a later start uses the stored token without opening the browser', async () => {
    const opened: string[] = [];
    const first = oauthSetup(browserThatSignsIn(opened));
    await first.manager.add({ ...notion, auth: 'oauth' });
    await first.manager.signIn('notion');
    const again = new ConnectionManager({
      store: first.store,
      secrets: first.secrets,
      emit: () => undefined,
      openBrowser: browserThatSignsIn(opened),
      transportFor: async (_c, ctx) =>
        new FakeOAuthTransport(await fakeMcpServer(TOOLS).transport(), ctx.authProvider!),
    });
    await again.start();
    expect(again.list()[0]?.status).toBe('connected');
    expect(opened).toHaveLength(1);
  });

  it('needs sign-in, without a browser, when nothing was ever signed in', async () => {
    const first = oauthSetup();
    await first.manager.add({ ...notion, auth: 'oauth' });
    const state = await first.manager.signIn('notion');
    expect(state.status).toBe('needs-sign-in');
    expect(state.error).toBe('Tagalong could not open a browser to sign in to Notion.');
  });

  it('a wrong state on the loopback is refused and the sign-in ends in a plain error', async () => {
    const { manager } = setup({
      openBrowser: (url) => {
        const back = new URL(new URL(url).searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'abc');
        back.searchParams.set('state', 'forged');
        void fetch(back);
      },
      signInTimeoutMs: 300,
      transportFor: async (_c, ctx) =>
        new FakeOAuthTransport(await fakeMcpServer(TOOLS).transport(), ctx.authProvider!),
    });
    await manager.add({ ...notion, auth: 'oauth' });
    const state = await manager.signIn('notion');
    expect(state.status).toBe('needs-sign-in');
    expect(state.error).toBe('Signing in to Notion did not finish. Try Sign in again.');
  });
});
