/**
 * A scripted brain for the e2e suites: a real websocket server speaking contract v1, so the
 * desktop's whole path (BrainClient, turn events, bubble) runs without Python or a model.
 * It answers hello, Home's permission, jobs and apps tools (`call`), then every say with the same short reply. A say that mentions "permission"
 * first opens one confirm ask and holds the turn until the desktop answers it, as the real
 * brain does. A say that mentions "hand off" replies, then (turn over) opens a job's three
 * asks one after another: a mode, a relayed permission, a question. Every `answer` frame is
 * recorded for the test, free text included.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

export const FAKE_REPLY = 'This is the fake brain.';

export interface FakeBrain {
  /** "127.0.0.1:port", what TAGALONG_BRAIN_ADDR wants. */
  addr: string;
  /** Every `answer` frame the desktop sent, in order. */
  answers: { ask: string; option: string; text?: string }[];
  /** Every `set_permission` call Home made, in order. */
  permissionSets: { tool: string; mode: string }[];
  /** Every job id Home sent to `stop_job`, in order. */
  stops: string[];
  close(): Promise<void>;
}

// One running Claude Code job, as the brain's list_jobs row (snake_case).
const JOB = {
  id: 'job1',
  agent: 'claude_code',
  task: 'Fix the build',
  folder: 'C:/work/app',
  mode: 'ask',
  state: 'running',
  reason: null,
  progress: 'Reading the config',
  result: null,
  started_at: '2026-10-27T10:00:00Z',
  ended_at: null,
} as Record<string, unknown>;

// One connected app, as the brain's list_apps row.
const APPS = [
  {
    id: 'files',
    name: 'Files',
    transport: 'stdio',
    auth: 'none',
    enabled: true,
    status: 'connected',
    error: '',
    tools: [{ name: 'files__read', effect: 'look', locked: false }],
  },
];

export async function startFakeBrain(): Promise<FakeBrain> {
  // Port 0: a free port, so a real brain on 47321 never collides with the suite.
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // Seq is the brain's, not the connection's: it keeps rising across a reconnect.
  let seq = 0;
  let turns = 0;
  const answers: FakeBrain['answers'] = [];
  const permissionSets: { tool: string; mode: string }[] = [];
  const stops: string[] = [];
  const jobs: Record<string, unknown>[] = [{ ...JOB }];
  const permissions = [
    {
      name: 'desktop__move_window',
      description: 'Move a window on your desktop',
      effect: 'change',
      mode: 'ask',
      locked: false,
      online: true,
    },
    {
      name: 'desktop__close_window',
      description: 'Close a window on your desktop',
      effect: 'change',
      mode: 'ask',
      locked: true,
      online: true,
    },
  ];

  server.on('connection', (socket: WebSocket) => {
    const notify = (method: string, params: Record<string, unknown>) =>
      socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: { seq: ++seq, ...params } }));
    // What a turn still has to say once its open ask is answered.
    const held = new Map<string, () => void>();

    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as {
        id?: string;
        method?: string;
        params?: { text?: string; ask?: string; option?: string };
      };
      if (msg.method === 'hello') {
        const result = { protocol: 1, session: 's1', tools: [], seq, resync: false };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } else if (msg.method === 'say') {
        const turn = `t${++turns}`;
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn, joined: false } }),
        );
        const base = { turn, body: 'desktop' };
        const finish = () => {
          notify('reply', { ...base, delta: 'This is the ' });
          notify('reply', { ...base, delta: 'fake brain.' });
          notify('reply', { ...base, done: true });
          notify('turn', { ...base, state: 'ended', reason: 'done' });
        };
        notify('turn', { ...base, state: 'started' });
        if (msg.params?.text?.includes('permission')) {
          const ask = `a${turns}`;
          held.set(ask, finish);
          notify('ask', {
            id: ask,
            state: 'open',
            turn,
            text: 'I will move the Notes window.',
            options: ['allow', 'always', 'deny'],
            confirm: true,
            tool: 'desktop__move_window',
            input: { x: 0 },
          });
        } else if (msg.params?.text?.includes('hand off')) {
          // The turn ends first: a job's asks come later, with no turn running, as in the brain.
          finish();
          const open = (id: string, fields: Record<string, unknown>, next?: () => void) => {
            if (next !== undefined) held.set(id, next);
            notify('ask', { id, state: 'open', ...fields });
          };
          const question = () =>
            open('j3', { text: 'Which branch should I use?', options: [] }, () => {
              // The job moves on: a second one shows up, and only a `changed` tells Home.
              jobs.push({ ...JOB, id: 'job2', task: 'Write the docs' });
              notify('changed', { what: 'jobs' });
            });
          const relayed = () =>
            open(
              'j2',
              {
                text: 'Claude Code wants to run a command.',
                options: ['Allow once', 'Reject'],
                tool: 'claude_code:Run tests',
                input: { command: 'pnpm test' },
              },
              question,
            );
          open(
            'j1',
            {
              text: 'How should Claude Code work?',
              options: ['ask', 'auto', 'cancel'],
              tool: 'hand_off',
              input: { folder: 'C:/work/app' },
            },
            relayed,
          );
        } else finish();
      } else if (msg.method === 'call') {
        // Home's tools: the permission pair and the jobs pair, kept in memory like the real brain.
        const params = msg.params as {
          tool?: string;
          input?: { tool?: string; mode?: string; job?: string };
        };
        let value: unknown = {};
        if (params.tool === 'list_jobs') value = { jobs };
        else if (params.tool === 'stop_job') {
          stops.push(String(params.input?.job));
          const row = jobs.find((j) => j.id === params.input?.job);
          if (row !== undefined) {
            row.state = 'stopped';
            row.ended_at = '2026-10-27T10:00:30Z';
          }
          notify('changed', { what: 'jobs' });
        } else if (params.tool === 'list_apps') value = { apps: APPS };
        else if (params.tool === 'list_permissions') value = { tools: permissions };
        else if (params.tool === 'set_permission') {
          const row = permissions.find((p) => p.name === params.input?.tool);
          if (row !== undefined) row.mode = String(params.input?.mode);
          permissionSets.push({
            tool: String(params.input?.tool),
            mode: String(params.input?.mode),
          });
          value = { tool: params.input?.tool, mode: params.input?.mode };
          notify('changed', { what: 'permissions' });
        }
        const output = [{ type: 'text', text: JSON.stringify(value) }];
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { output } }));
      } else if (msg.method === 'answer') {
        const ask = String(msg.params?.ask);
        const text = msg.params?.text;
        answers.push({
          ask,
          option: String(msg.params?.option),
          ...(text === undefined ? {} : { text }),
        });
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        notify('ask', { id: ask, state: 'closed', reason: 'answered', option: msg.params?.option });
        held.get(ask)?.();
        held.delete(ask);
      }
    });
  });

  return {
    addr: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    answers,
    permissionSets,
    stops,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}
