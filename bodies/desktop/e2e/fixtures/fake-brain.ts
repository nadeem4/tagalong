/**
 * A scripted brain for the e2e suites: a real websocket server speaking contract v1, so the
 * desktop's whole path (BrainClient, turn events, bubble) runs without Python or a model.
 * It answers hello, then every say with the same short reply.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

export const FAKE_REPLY = 'This is the fake brain.';

export interface FakeBrain {
  /** "127.0.0.1:port", what TAGALONG_BRAIN_ADDR wants. */
  addr: string;
  close(): Promise<void>;
}

export async function startFakeBrain(): Promise<FakeBrain> {
  // Port 0: a free port, so a real brain on 47321 never collides with the suite.
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // Seq is the brain's, not the connection's: it keeps rising across a reconnect.
  let seq = 0;
  let turns = 0;

  server.on('connection', (socket: WebSocket) => {
    const notify = (method: string, params: Record<string, unknown>) =>
      socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: { seq: ++seq, ...params } }));

    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: string; method?: string };
      if (msg.method === 'hello') {
        const result = { protocol: 1, session: 's1', tools: [], seq, resync: false };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } else if (msg.method === 'say') {
        const turn = `t${++turns}`;
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn, joined: false } }),
        );
        const base = { turn, body: 'desktop' };
        notify('turn', { ...base, state: 'started' });
        notify('reply', { ...base, delta: 'This is the ' });
        notify('reply', { ...base, delta: 'fake brain.' });
        notify('reply', { ...base, done: true });
        notify('turn', { ...base, state: 'ended', reason: 'done' });
      }
    });
  });

  return {
    addr: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}
