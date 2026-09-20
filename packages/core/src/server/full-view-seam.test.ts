import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { EngineServer, type HostSession } from './ws-server';
import { createPerceptionToolset, type PerceptionHost } from '../perception';

/**
 * The seam the last two bugs lived in.
 *
 * Every tool test in `perception` hands the toolset a fake host, and every parser test in
 * the desktop host feeds fixture output — so a tool can be perfect, a host can be perfect,
 * and the method between them can be unimplemented with the whole suite green. That is
 * exactly how Phase 2B shipped a dead window enumeration and then a capture path that
 * answered `perception.capture(['displays'])` with nothing.
 *
 * These tests run a real `EngineServer`, connect a real socket, and drive the tools the
 * model actually calls. If a `perception.*` method is missing from `HostSession`, or the
 * toolset asks for a method by a name the session does not answer, they go red.
 */

let server: EngineServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
});

const TOKEN = 'a-pairing-token';

/** A host socket that answers whatever core-to-host request arrives. */
class TestHost {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<string | number, (value: unknown) => void>();
  /** Set per test: what to answer, keyed by the method the engine asked for. */
  answers: Record<string, unknown> = {};
  asked: string[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: string | number;
        method?: string;
        result?: unknown;
      };
      if (message.method !== undefined && message.id !== undefined) {
        this.asked.push(message.method);
        const answer = this.answers[message.method];
        socket.send(
          JSON.stringify(
            answer === undefined
              ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } }
              : { jsonrpc: '2.0', id: message.id, result: answer },
          ),
        );
        return;
      }
      if (message.id !== undefined) {
        this.#pending.get(message.id)?.(message.result);
        this.#pending.delete(message.id);
      }
    });
  }

  static async connect(port: number): Promise<TestHost> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new TestHost(socket);
  }

  call(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
}

async function engineWithHost(
  capabilities: readonly string[] = ['screenshot', 'activeWindow', 'displays', 'textLayer'],
): Promise<{ host: TestHost; sessions: () => readonly HostSession[] }> {
  server = await EngineServer.start({
    port: 0,
    token: TOKEN,
    engineVersion: '0.0.0-test',
    listPets: () => [],
    handlers: {},
  });
  const host = await TestHost.connect(server.port);
  await host.call('hello', {
    host: 'desktop',
    version: '0.0.0-test',
    capabilities,
    token: TOKEN,
  });
  const live = server;
  return { host, sessions: () => live.sessions() };
}

/** The toolset, bound to the real sessions of a real server. */
function toolsetOver(
  sessions: () => readonly HostSession[],
): ReturnType<typeof createPerceptionToolset> {
  return createPerceptionToolset({
    hosts: () => sessions() as unknown as readonly PerceptionHost[],
    exclusions: () => ({ processNames: [], titlePatterns: [] }),
    vision: () => true,
  });
}

const WINDOW = {
  id: 'w-1',
  processName: 'Code.exe',
  title: 'displays.ts',
  displayId: 1,
  state: 'background',
  browser: false,
};

describe('the full-view tools, over a real socket', () => {
  it('list_windows reaches the host as perception.listWindows', async () => {
    const { host, sessions } = await engineWithHost();
    host.answers['perception.listWindows'] = { windows: [WINDOW] };

    const result = await toolsetOver(sessions).run({ name: 'list_windows' });

    expect(host.asked).toContain('perception.listWindows');
    expect(result.isError).toBeFalsy();
    expect(String(result.content)).toContain('w-1');
  });

  it('look_closer reaches the host as perception.captureRegion, and comes back as pixels', async () => {
    const { host, sessions } = await engineWithHost();
    host.answers['perception.captureRegion'] = {
      image: { mime: 'image/png', base64: 'aGk=', width: 640, height: 480 },
    };

    const result = await toolsetOver(sessions).run({
      name: 'look_closer',
      input: { displayId: 1, rect: { x: 0, y: 0, width: 640, height: 480 } },
    });

    expect(host.asked).toContain('perception.captureRegion');
    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('read_window_text reaches the host as perception.readText', async () => {
    const { host, sessions } = await engineWithHost();
    host.answers['perception.readText'] = {
      windowId: 'w-1',
      text: 'error TS2532',
      truncated: false,
      source: 'uia',
    };

    const result = await toolsetOver(sessions).run({
      name: 'read_window_text',
      input: { windowId: 'w-1' },
    });

    expect(host.asked).toContain('perception.readText');
    expect(String(result.content)).toContain('error TS2532');
  });

  it('list_displays and look_at_display reach the host as perception.capture', async () => {
    const { host, sessions } = await engineWithHost();
    host.answers['perception.capture'] = {
      snapshot: {
        displays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,
            primary: true,
            focused: true,
            image: { mime: 'image/png', base64: 'aGk=', width: 1568, height: 882 },
          },
        ],
      },
    };

    const listed = await toolsetOver(sessions).run({ name: 'list_displays' });
    expect(host.asked).toContain('perception.capture');
    expect(String(listed.content)).toContain('1920');

    const looked = await toolsetOver(sessions).run({
      name: 'look_at_display',
      input: { displayId: 1 },
    });
    expect(Array.isArray(looked.content)).toBe(true);
  });

  it('a host that does not advertise the capability refuses rather than hanging', async () => {
    const { sessions } = await engineWithHost(['screenshot', 'activeWindow']);

    const result = await toolsetOver(sessions).run({ name: 'list_windows' });

    expect(result.isError).toBe(true);
    expect(String(result.content).toLowerCase()).toContain('no connected host');
  });
});
