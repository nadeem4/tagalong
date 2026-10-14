import { describe, expect, it } from 'vitest';
import {
  Connection,
  ConnectionsAddParams,
  ConnectorConfirmParams,
  connectionIdFrom,
} from './connections';
import { coreToHostNotifications, hostToCoreMethods } from './methods';

describe('Connection', () => {
  it('accepts a remote app signed in with OAuth', () => {
    const parsed = Connection.parse({
      id: 'notion',
      name: 'Notion',
      transport: { type: 'http', url: 'https://mcp.notion.com/mcp' },
      auth: 'oauth',
      enabled: true,
    });
    expect(parsed.secretNames).toEqual([]);
  });

  it('accepts a local command with env, and defaults args and env', () => {
    const parsed = Connection.parse({
      id: 'files',
      name: 'Files',
      transport: { type: 'stdio', command: 'npx' },
      auth: 'none',
      enabled: true,
    });
    expect(parsed.transport).toEqual({ type: 'stdio', command: 'npx', args: [], env: {} });
  });

  it('refuses an id the tool names cannot carry', () => {
    expect(() =>
      Connection.parse({
        id: 'My App!',
        name: 'x',
        transport: { type: 'http', url: 'https://x.example/mcp' },
        auth: 'none',
        enabled: true,
      }),
    ).toThrow();
  });

  it('refuses a plain-http remote URL other than loopback', () => {
    const remote = (url: string) =>
      ConnectionsAddParams.safeParse({ name: 'x', transport: { type: 'http', url }, auth: 'none' });
    expect(remote('http://evil.example/mcp').success).toBe(false);
    expect(remote('http://127.0.0.1:8080/mcp').success).toBe(true);
    expect(remote('https://x.example/mcp').success).toBe(true);
  });
});

describe('connectionIdFrom', () => {
  it('makes a short slug that fits a tool name prefix', () => {
    expect(connectionIdFrom('Google Calendar', [])).toBe('google-calendar');
    expect(connectionIdFrom('Notion', ['notion'])).toBe('notion-2');
    expect(connectionIdFrom('!!!', [])).toBe('app');
  });
});

describe('catalog', () => {
  it('lists the connection methods and notifications', () => {
    for (const method of [
      'connections.list',
      'connections.add',
      'connections.setEnabled',
      'connections.signIn',
      'connections.remove',
    ] as const) {
      expect(hostToCoreMethods[method].params).toBeDefined();
    }
    expect(coreToHostNotifications['connections.changed'].params).toBeDefined();
    expect(coreToHostNotifications['connector.confirm'].params).toBe(ConnectorConfirmParams);
  });

  it('a confirm names the app, the tool and what will happen', () => {
    const parsed = ConnectorConfirmParams.parse({
      approvalId: '6f1c1b8e-3b1c-4c8e-9a51-0b1f6f1d2a3b',
      turnId: '6f1c1b8e-3b1c-4c8e-9a51-0b1f6f1d2a3c',
      petId: 'scout',
      app: 'Notion',
      tool: 'create-pages',
      summary: 'Create a page called Plan',
    });
    expect(parsed.app).toBe('Notion');
  });
});
