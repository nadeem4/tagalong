/** Tests for the app shapes: the brain's list_apps answer, add_app params and the confirm card. */
import { describe, expect, it } from 'vitest';
import { AppAddParams, AppsList, ConnectorConfirmParams, ConnectorDismissParams } from './apps';

describe('confirm card', () => {
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

  it("takes the brain's ask ids (uuid hex) and an ask with no turn", () => {
    const parsed = ConnectorConfirmParams.parse({
      approvalId: '6f1c1b8e3b1c4c8e9a510b1f6f1d2a3b',
      turnId: '',
      petId: 'scout',
      app: 'Scout',
      tool: 'forget_memory',
      summary: 'Forget it',
    });
    expect(parsed.turnId).toBe('');
  });

  it('a dismissal names the card to drop', () => {
    expect(ConnectorDismissParams.parse({ approvalId: 'a1' })).toEqual({ approvalId: 'a1' });
  });
});

// Shapes below mirror brain/src/brain/app_tools.py (`app_home_tools`), the brain's Home calls.
describe('AppsList', () => {
  it("parses the brain's list_apps answer", () => {
    const parsed = AppsList.parse({
      apps: [
        {
          id: 'notion',
          name: 'Notion',
          transport: 'http',
          auth: 'token',
          enabled: true,
          status: 'connected',
          error: '',
          tools: [
            { name: 'search', effect: 'read', locked: false },
            { name: 'create-pages', effect: 'change', locked: true },
          ],
        },
      ],
    });
    expect(parsed.apps[0]?.tools).toHaveLength(2);
  });

  it('parses where an app runs: url for http, command and args for stdio', () => {
    const base = { auth: 'none', enabled: true, status: 'connected', error: '', tools: [] };
    const parsed = AppsList.parse({
      apps: [
        {
          ...base,
          id: 'wiki',
          name: 'Wiki',
          transport: 'http',
          url: 'https://wiki.example.com/mcp',
        },
        {
          ...base,
          id: 'files',
          name: 'Files',
          transport: 'stdio',
          command: 'node',
          args: ['f.js'],
        },
      ],
    });
    expect(parsed.apps[0]?.url).toBe('https://wiki.example.com/mcp');
    expect(parsed.apps[1]).toMatchObject({ command: 'node', args: ['f.js'] });
  });

  it('refuses an unknown transport', () => {
    const bad = {
      apps: [
        {
          id: 'x',
          name: 'X',
          transport: 'carrier-pigeon',
          auth: 'none',
          enabled: true,
          status: 'off',
          error: '',
          tools: [],
        },
      ],
    };
    expect(AppsList.safeParse(bad).success).toBe(false);
  });
});

describe('AppAddParams', () => {
  it('needs a command for stdio and a url for http', () => {
    const base = { name: 'X', auth: 'none' };
    expect(AppAddParams.safeParse({ ...base, transport: 'stdio' }).success).toBe(false);
    expect(AppAddParams.safeParse({ ...base, transport: 'stdio', command: 'npx' }).success).toBe(
      true,
    );
    expect(AppAddParams.safeParse({ ...base, transport: 'http' }).success).toBe(false);
    expect(
      AppAddParams.safeParse({ ...base, transport: 'http', url: 'https://x.example/mcp' }).success,
    ).toBe(true);
  });

  it('refuses an unknown transport or auth', () => {
    expect(AppAddParams.safeParse({ name: 'X', transport: 'ws', auth: 'none' }).success).toBe(
      false,
    );
    expect(
      AppAddParams.safeParse({ name: 'X', transport: 'stdio', command: 'a', auth: 'magic' })
        .success,
    ).toBe(false);
  });

  it('takes a token only with auth token, and token auth needs one', () => {
    const http = { name: 'X', transport: 'http', url: 'https://x.example/mcp' };
    expect(AppAddParams.safeParse({ ...http, auth: 'token', token: 't' }).success).toBe(true);
    expect(AppAddParams.safeParse({ ...http, auth: 'token' }).success).toBe(false);
    expect(AppAddParams.safeParse({ ...http, auth: 'none', token: 't' }).success).toBe(false);
  });

  it('keeps token sign-in to http apps', () => {
    const stdio = { name: 'X', transport: 'stdio', command: 'npx', auth: 'token', token: 't' };
    expect(AppAddParams.safeParse(stdio).success).toBe(false);
  });
});
