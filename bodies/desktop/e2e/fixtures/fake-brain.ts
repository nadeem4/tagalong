/**
 * A scripted brain for the e2e suites: a real websocket server speaking contract v1, so the
 * desktop's whole path (BrainClient, turn events, bubble) runs without Python or a model.
 * It answers hello, Home's permission, jobs, apps and approvals tools (`call`), then every say with the same short reply. A say that mentions "permission"
 * first opens one confirm ask and holds the turn until the desktop answers it, as the real
 * brain does. A say that mentions "offer" opens an offer ask (Yes, auto-approve / Keep asking).
 * A say that mentions "windows" sends the body a `use` for list_windows and replies with
 * the error text if the tool failed (how a paused sight shows up).
 * A say that mentions "hand off" replies, then (turn over) opens a job's three
 * asks one after another: a mode, a relayed permission, a question. Every `answer` frame is
 * recorded for the test, free text included. The key tools (`key_status`, `set_api_key`, `spend_today` ($0.42),
 * `set_daily_limit`, `setup_overview`) follow `FakeBrainOptions`; the brain counts key attempts
 * and keeps no key.
 *
 * Voice: `listen` is answered, and a few `mic` frames later it sends `heard` frames (held: the
 * live words, then the question once `unlisten` arrives; always: the whole question). A say
 * asked `spoken` is followed by `speech` frames, one sentence with a tiny silent clip, then
 * `speech {done}`; so is every say once the desktop sent `read_aloud {on: true}` (text only when
 * it also said `system_voice`); the sentence is numbered `n: 1`. Listen, unlisten, hush, mic
 * counts, read_aloud events and every say's params are recorded for the test, and `hear` pushes
 * a `heard` frame at will.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ownBuild } from '../../src/main/brain/build-id';

/**
 * The version and build the app itself would report in dev, so a default fake brain is current
 * and ordinary specs see no update prompt. Only the version specs pass an old `hello`.
 */
const own = ownBuild({
  packaged: false,
  appVersion: (
    JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
  ).version,
  brainDir: fileURLToPath(new URL('../../../../brain', import.meta.url)),
});

/** How the fake brain behaves about the Anthropic key. */
export interface FakeBrainOptions {
  /** Whether the brain starts with a key (default true, so other suites see no key state). */
  hasKey?: boolean;
  /** What each `set_api_key` answers, in order; the last one repeats. Default: ok. */
  keyResults?: ('ok' | 'invalid' | 'unreachable')[];
  /** The key comes from the brain's environment: `key_status` says so (needs `hasKey`). */
  environment?: boolean;
  /** Listen here instead of on a free port, so a spec can start the brain after the app. */
  port?: number;
  /** What hello says of the brain's version and build (default: the app's own, a current brain). */
  hello?: { version: string; build: string };
  /** The `brain_status` answer (snake_case, as the real tool); absent: the tool is unknown, as on an old brain. */
  brainStatus?: Record<string, unknown>;
}

export interface FakeBrain {
  /** "127.0.0.1:port", what TAGALONG_BRAIN_ADDR wants. */
  addr: string;
  /** Every `answer` frame the desktop sent, in order. */
  answers: { ask: string; option: string; text?: string; apps?: string[] }[];
  /** Every `set_permission` call Home made, in order. */
  permissionSets: { tool: string; mode: string }[];
  /** Every loops call the page made, in order: `set gmail on`, `forget l1`, `wipe`. */
  loopCalls: string[];
  /** Replace the timers `timers_state` answers (snake_case rows) and tell the bodies `changed: timers`. */
  setTimers(rows: Record<string, unknown>[]): void;
  /** Every timer id Home sent to `timer_cancel`, in order. */
  timerCancels: string[];
  /** The data of every `reading` event the desktop sent (how this PC reads the screen). */
  readingEvents: Record<string, unknown>[];
  /** Replace the rows `reading_status` answers and tell the bodies `changed: reading`. */
  setReading(rows: Record<string, unknown>[]): void;
  /**
   * Add fields to the `setup_overview` answer (progress, failed...), optionally make searches fail
   * (`true`) or never answer (`'hang'`, for a steady "Searching…" shot), and tell the bodies
   * `changed: setup`.
   */
  setSetup(patch: Record<string, unknown>, failingSearches?: boolean | 'hang'): void;
  /** How many times `set_api_key` was called (the key itself is never recorded). */
  keyAttempts: number;
  /** Every amount Settings sent to `set_daily_limit`, in order. */
  limits: number[];
  /** Every job id Home sent to `stop_job`, in order. */
  stops: string[];
  /** Every expert id the desktop sent to `setup_expert`, in order (the first one installs it). */
  expertSetups: string[];
  /** The `approved` flag of each setup_expert call: the tour's press must send true. */
  expertApprovals: unknown[];
  /** Every app id the desktop sent to `setup_app`, in order (the tour's Connect). */
  appSetups: string[];
  /** The `approved` and `community_ok` flags of each setup_app call, in order. */
  appFlags: { approved: unknown; communityOk: unknown }[];
  /** Every preference id Home sent to `remove_preference`, in order. */
  removedPreferences: number[];
  /** What the desktop asked of the brain's ears and mouth, in order. */
  voice: {
    listens: string[];
    unlistens: number;
    hushes: number;
    mics: number;
    /** Turns the brain spoke: a spoken say, or any say once the body asked for read-aloud. */
    spokenSays: number;
    /** Every `read_aloud` event the desktop sent, in order. */
    readAloud: Record<string, unknown>[];
    /** The params of every `say` the desktop sent, in order. */
    says: Record<string, unknown>[];
  };
  /** The ears hear something now: a live `heard` frame to every connected body. */
  hear(event: string, text?: string): void;
  /** Add a step to a job's activity log (new `rev`) and tell the bodies `changed: job_activity`. */
  pushActivity(
    job: string,
    entry: { kind: string; text: string; status?: string; step?: string; exit?: number },
  ): void;
  /** Replace Scout's watch list for a job and tell the bodies `changed: job_activity`. */
  setWatch(job: string, items: { text: string; done: boolean }[]): void;
  /** Set what `job_activity` with no job returns (the bubble's live line) and tell the bodies `changed: what`. */
  setRunning(
    steps: { job: string; expert: string; text: string; at: string }[],
    what: string,
  ): void;
  /** Tell every connected body that Scout approved an ask under a preference. */
  sendApproved(note: { tool: string; text: string; preference: string }): void;
  /** Scout starts a turn on its own and says one line: the desktop shows it as a quiet line. */
  sendRemark(text: string): void;
  close(): Promise<void>;
}

// One running Claude Code job, as the brain's list_jobs row (snake_case).
const JOB = {
  id: 'job1',
  // Long on purpose: Home must clip it, never widen the page (smoke.spec checks).
  task: 'Fix the build and then keep going through every failing check until the whole pipeline is green again',
  folder: 'C:/work/app',
  mode: 'ask',
  state: 'running',
  title: null,
  started_at: '2026-10-27T10:00:00Z',
  ended_at: null,
  closed_at: null,
  parts: [
    {
      id: 'p1',
      expert: 'claude_code',
      state: 'running',
      reason: null,
      progress: 'Reading the config',
      result: null,
      session_id_known: false,
      started_at: '2026-10-27T10:00:00Z',
      ended_at: null,
    },
  ],
  activity: true,
} as Record<string, unknown>;

// A job's steps, as job_activity sends them: a command, its output, and the end line.
const JOB_STEPS = [
  { rev: 1, seq: 1, kind: 'command', text: 'npm test', status: 'done', step: 's1', exit: null },
  { rev: 2, seq: 2, kind: 'output', text: 'all green', status: null, step: 's1', exit: null },
  { rev: 3, seq: 3, kind: 'end', text: '# done', status: null, step: null, exit: null },
].map((e) => ({ ...e, at: '2026-10-27T10:00:05Z', part: 'p1', source: null }));

// Scout's long result for the two-expert job: a table and more than the 1000 characters the
// brain's list_jobs keeps for Scout (job_activity carries the whole text for Home).
const LONG_RESULT = `The notes are drafted and **reviewed**.

| File | Change |
|---|---|
| a.md | new |

${'More detail. '.repeat(120)}The very end.`;

// A finished job with two experts (parts) and a title and result Scout wrote.
const TWO_PART_JOB = {
  id: 'job2',
  task: 'Ship the release notes',
  folder: 'C:/work/app',
  mode: 'ask',
  state: 'done',
  title: 'Release notes for 1.2',
  scout_result: LONG_RESULT,
  started_at: '2026-10-27T09:00:00Z',
  ended_at: '2026-10-27T09:04:00Z',
  closed_at: '2026-10-27T09:05:00Z',
  parts: ['p1', 'p2'].map((id, n) => ({
    id,
    expert: n === 0 ? 'Claude Code' : 'Gemini',
    state: 'done',
    reason: null,
    progress: null,
    result: null,
    session_id_known: false,
    started_at: `2026-10-27T09:0${n}:00Z`,
    ended_at: `2026-10-27T09:0${n + 2}:00Z`,
  })),
  activity: true,
} as Record<string, unknown>;
const TWO_PART_REPORTS: Record<string, string> = {
  'job2/p1': '## Drafted\n\nWrote the notes. <script>bad()</script>',
  'job2/p2': 'Reviewed: **no changes needed**.',
};
const TWO_PART_STEPS = [
  { rev: 1, seq: 1, kind: 'command', text: 'draft', status: 'done', part: 'p1', source: null },
  {
    rev: 2,
    seq: 2,
    kind: 'tool',
    text: 'read changelog',
    status: 'done',
    part: 'scout',
    source: 'app:files',
  },
  { rev: 3, seq: 3, kind: 'command', text: 'review', status: 'done', part: 'p2', source: null },
].map((e) => ({
  ...e,
  at: '2026-10-27T09:01:00Z',
  step: null,
  exit: null,
}));

// A memory with one unbroken word, the worst case for the memory row's width.
const LONG_FACT = `Remembers ${'supercalifragilistic'.repeat(8)} and a long story about the launch.`;

// One connected app, as the brain's list_apps row.
/** A registry search for "notion": the Official head and two community versions of one service. */
const notionRow = (id: string, official: boolean, publisher: string) => ({
  id,
  name: 'Notion',
  version: '1',
  description: 'Notion pages',
  official,
  added: false,
  publisher,
  runs: official ? 'hosted' : 'pc',
  host: official ? 'mcp.notion.com' : null,
  sign_in: official ? 'browser' : 'key',
  licence: official ? 'Proprietary' : 'MIT',
  repo: official ? '' : `https://example.test/${id}`,
  // Official rows carry no why-pick: the row falls back to the description.
  ...(official ? {} : { why: 'Matches the name' }),
});
const NOTION_GROUP = {
  service: 'Notion',
  official: notionRow('com.notion/mcp', true, 'Notion'),
  others: [
    notionRow('io.example/notion-a', false, 'Ada'),
    notionRow('io.example/notion-b', false, 'Bo'),
  ],
};

const expertChoice = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  version: '1',
  description: `${name} works on long jobs`,
  official: true,
  recommended: false,
  tested: true,
  added: false,
  account: false,
  licence: 'MIT',
  repo: `https://example.test/${id}`,
  ...over,
});
const BROWSE_EXPERTS = [
  expertChoice('claude-acp', 'Claude Code', { recommended: true, account: true }),
  expertChoice('codex-acp', 'Codex', { account: true }),
  expertChoice('goose', 'Goose', { official: false, tested: false }),
];

const APPS = [
  {
    id: 'files',
    name: 'Files',
    transport: 'stdio',
    auth: 'none',
    enabled: true,
    status: 'connected',
    error: '',
    command: 'node',
    args: ['files-server.js'],
    tools: [{ name: 'files__read', effect: 'look', locked: false }],
  },
  {
    id: 'wiki',
    name: 'Wiki of everything the whole company has ever written down in one place',
    transport: 'http',
    auth: 'none',
    enabled: true,
    status: 'connected',
    error: '',
    url: 'https://wiki.example.com/mcp',
    tools: [],
  },
];

// The approvals page's data, as the brain's snake_case rows: one ask Scout answered under a
// preference, one the person approved, one refused.
const DEFAULT_PREFERENCE = {
  id: 1,
  sentence: 'Always ask me before risky actions',
  builtin: true,
  created_at: '2026-10-20T09:00:00Z',
  use_count: 0,
  last_used: null,
};
const TEST_PREFERENCE = {
  id: 2,
  sentence: 'Approve test runs in C:/work/app',
  builtin: false,
  created_at: '2026-10-25T09:00:00Z',
  use_count: 3,
  last_used: '2026-10-27T10:00:00Z',
};
const APPROVALS = [
  {
    id: 3,
    source: 'claude_code',
    tool: 'claude_code:Run tests',
    summary: 'Run pnpm test',
    outcome: 'approved',
    decided_by: 'scout',
    preference: TEST_PREFERENCE.sentence,
    at: '2026-10-27T10:00:00Z',
  },
  {
    id: 2,
    source: 'scout_tool',
    tool: 'desktop__move_window',
    summary: 'Move the Notes window',
    outcome: 'approved',
    decided_by: 'person',
    preference: null,
    at: '2026-10-27T09:30:00Z',
  },
  {
    id: 1,
    source: 'claude_code',
    tool: 'claude_code:Run command',
    summary: 'Delete the build folder',
    outcome: 'refused',
    decided_by: 'person',
    preference: null,
    at: '2026-10-27T09:00:00Z',
  },
];

export async function startFakeBrain(options: FakeBrainOptions = {}): Promise<FakeBrain> {
  // Port 0: a free port, so a real brain on 47321 never collides with the suite.
  const server = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // Seq is the brain's, not the connection's: it keeps rising across a reconnect.
  let seq = 0;
  let turns = 0;
  const answers: FakeBrain['answers'] = [];
  const permissionSets: { tool: string; mode: string }[] = [];
  // Home's loops: one mail app, off at first. Turning it on "reads" one mail into a held loop,
  // as the brain's first poll would; forget and wipe edit the list.
  const loopCalls: string[] = [];
  let timers: Record<string, unknown>[] = [];
  const timerCancels: string[] = [];
  const loopApps = [{ id: 'gmail', name: 'Gmail', on: false }];
  let heldLoops: Record<string, unknown>[] = [];
  const stops: string[] = [];
  const expertSetups: string[] = [];
  const expertApprovals: unknown[] = [];
  const appSetups: string[] = [];
  const appFlags: { approved: unknown; communityOk: unknown }[] = [];
  let expertInstalled = false;
  // Screenshot states for Connections: extra overview fields, and searches that fail.
  let setupPatch: Record<string, unknown> = {};
  let failSearches: boolean | 'hang' = false;
  let gmailConnected = false;
  const limits: number[] = [];
  let hasKey = options.hasKey ?? true;
  let dailyLimitUsd = 5;
  const keyResults = [...(options.keyResults ?? ['ok'])];
  const keyCalls = { attempts: 0 };
  const removedPreferences: number[] = [];
  const preferences: Record<string, unknown>[] = [
    { ...DEFAULT_PREFERENCE },
    { ...TEST_PREFERENCE },
  ];
  const readingEvents: Record<string, unknown>[] = [];
  let readingRows: Record<string, unknown>[] = [];
  const voice: FakeBrain['voice'] = {
    listens: [],
    unlistens: 0,
    hushes: 0,
    mics: 0,
    spokenSays: 0,
    readAloud: [],
    says: [],
  };
  // 3 s of silence at the mouth's 24 kHz: long enough for a test to see the panel speaking
  // and press Stop before it ends on its own.
  const SILENCE = Buffer.alloc(24_000 * 3 * 2).toString('base64');
  const sockets = new Set<WebSocket>();
  const jobs: Record<string, unknown>[] = [{ ...JOB }, { ...TWO_PART_JOB }];
  const activity: Record<string, Record<string, unknown>[]> = {
    job1: [...JOB_STEPS],
    job2: [...TWO_PART_STEPS],
  };
  const watches: Record<string, { text: string; done: boolean }[]> = {
    job1: [
      { text: 'tests pass', done: true },
      { text: 'README updated', done: false },
    ],
  };
  let running: unknown[] = [];
  // Rows and groups as list_permissions sends them: plain words, grouped, each with what it allows.
  const row = (
    name: string,
    title: string,
    line: string,
    info: string,
    group: string,
    source: string,
    source_name: string,
    flags: Record<string, unknown> = {},
  ) => ({
    name,
    description: `${title} (the model's own description)`,
    title,
    line,
    info,
    group,
    effect: 'change',
    mode: 'ask',
    locked: false,
    self_asks: false,
    person_only: false,
    online: true,
    source,
    source_name,
    ...flags,
  });
  const permissionGroups = [
    { id: 'memory', title: 'Memory', note: 'Things Scout keeps between chats.' },
    {
      id: 'jobs',
      title: 'Jobs and experts',
      note: 'Bigger work Scout hands to an expert such as Claude Code.',
    },
    {
      id: 'computer',
      title: 'This computer',
      note: 'Windows and files. File tools only work inside folders you allowed.',
    },
    {
      id: 'browser',
      title: 'Chrome on work PC',
      note: 'Your browser',
    },
    { id: 'app:gmail', title: 'Gmail', note: 'From Gmail' },
  ];
  const permissions = [
    row(
      'recall',
      'Look back in memory',
      'Searches saved notes, past chats and past jobs.',
      'When something may have come up before, Scout searches what it saved.',
      'memory',
      'built_in',
      'Built in',
      { effect: 'read', mode: 'auto' },
    ),
    row(
      'hand_off',
      'Hand work to an expert',
      'Sends a task to an expert like Claude Code.',
      'For bigger work, Scout passes the task to an expert.',
      'jobs',
      'built_in',
      'Built in',
      { mode: 'auto', self_asks: true },
    ),
    row(
      'desktop__list_windows',
      'See open windows',
      "Lists your open windows, not what's in them.",
      "Scout sees each window's name and whether it's in front, behind or minimized.",
      'computer',
      'body:desktop',
      'Desktop',
      { effect: 'read', mode: 'auto' },
    ),
    row(
      'desktop__open_url',
      'Open a link',
      'Opens a web page in your browser.',
      'Scout opens a secure (https) page, usually a sign-in page for an app.',
      'computer',
      'body:desktop',
      'Desktop',
      { locked: true },
    ),
    row(
      'extension__tabs',
      'See and read tabs',
      'Lists your tabs and reads the one you need.',
      'Scout finds the tab you mean and reads its text.',
      'browser',
      'body:extension',
      'Chrome on work PC',
      { effect: 'read', mode: 'auto', online: false },
    ),
    row(
      'gmail__delete_mail',
      'delete_mail',
      'Delete an email',
      '',
      'app:gmail',
      'app:gmail',
      'Gmail',
      {
        locked: true,
        person_only: true,
      },
    ),
  ];

  server.on('connection', (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const notify = (method: string, params: Record<string, unknown>) =>
      socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: { seq: ++seq, ...params } }));
    // What a turn still has to say once its open ask is answered.
    const held = new Map<string, () => void>();
    // The ears' side of this connection: the mode asked for and the frames since.
    let mode: string | null = null;
    let frames = 0;
    // The body's last `read_aloud` event on this connection: what makes a typed say spoken.
    let readAloud: { on?: boolean; system_voice?: boolean } = {};
    // Voice frames are live-only: no seq, never replayed.
    const live = (method: string, params: Record<string, unknown>) =>
      socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));

    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as {
        id?: string;
        method?: string;
        params?: {
          text?: string;
          ask?: string;
          option?: string;
          spoken?: boolean;
          mode?: string;
          apps?: string[];
          name?: string;
          data?: unknown;
        };
        result?: unknown;
        error?: { code: number; message: string };
      };
      if (msg.method === undefined && msg.id?.startsWith('use-') === true) {
        // The body's answer to the list_windows `use` sent below: say what came back.
        const turn = msg.id.slice('use-'.length);
        const base = { turn, body: 'desktop' };
        notify('reply', { ...base, delta: msg.error?.message ?? 'The windows were listed.' });
        notify('reply', { ...base, done: true });
        notify('turn', { ...base, state: 'ended', reason: 'done' });
      } else if (msg.method === 'hello') {
        const result = {
          protocol: 1,
          session: 's1',
          tools: [],
          seq,
          resync: false,
          ...(options.hello ?? own),
        };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } else if (msg.method === 'listen') {
        mode = String(msg.params?.mode);
        frames = 0;
        voice.listens.push(mode);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      } else if (msg.method === 'mic') {
        voice.mics += 1;
        frames += 1;
        if (frames === 3 && mode === 'held') {
          live('heard', { event: 'speech_start' });
          live('heard', { event: 'partial', text: 'What am I' });
        } else if (frames === 3 && mode === 'always') {
          live('heard', { event: 'speech_start' });
          live('heard', { event: 'final', text: 'Scout, what am I looking at?' });
          live('heard', { event: 'turn_end', text: 'Scout, what am I looking at?' });
        }
      } else if (msg.method === 'unlisten') {
        // Letting go of the talk key ends a held question.
        if (mode === 'held' && frames >= 3) {
          live('heard', { event: 'final', text: 'What am I looking at?' });
          live('heard', { event: 'turn_end', text: 'What am I looking at?' });
        }
        voice.unlistens += 1;
        mode = null;
      } else if (msg.method === 'hush') {
        voice.hushes += 1;
      } else if (msg.method === 'event') {
        if (msg.params?.name === 'reading') {
          readingEvents.push((msg.params.data ?? {}) as Record<string, unknown>);
        }
        if (msg.params?.name === 'read_aloud') {
          readAloud = (msg.params.data ?? {}) as typeof readAloud;
          voice.readAloud.push({ ...readAloud });
        }
      } else if (msg.method === 'say') {
        voice.says.push({ ...msg.params });
        const turn = `t${++turns}`;
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn, joined: false } }),
        );
        const base = { turn, body: 'desktop' };
        const spoken = msg.params?.spoken === true || readAloud.on === true;
        const finish = () => {
          notify('reply', { ...base, delta: 'This is the ' });
          notify('reply', { ...base, delta: 'fake brain.' });
          notify('reply', { ...base, done: true });
          notify('turn', { ...base, state: 'ended', reason: 'done' });
          if (spoken) {
            voice.spokenSays += 1;
            // The system voice gets text only: the real brain never loads its own voice for it.
            const audio =
              readAloud.system_voice === true ? {} : { pcm: SILENCE, sample_rate: 24000 };
            live('speech', { turn, n: 1, text: 'This is the fake brain.', ...audio });
            live('speech', { turn, done: true });
          }
        };
        notify('turn', { ...base, state: 'started' });
        if (msg.params?.text?.includes('windows')) {
          // Runs the body's own list_windows tool; the answer comes back above.
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: `use-${turn}`,
              method: 'use',
              params: { call: `c-${turn}`, tool: 'list_windows', input: {} },
            }),
          );
        } else if (msg.params?.text?.includes('permission')) {
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
        } else if (msg.params?.text?.includes('offer')) {
          // The turn ends first; the offer is a plain ask, as the brain sends it.
          finish();
          notify('ask', {
            id: 'o1',
            state: 'open',
            text: 'You’ve allowed C:/work/app 3 times lately. Approve it from now on?',
            options: ['Yes, auto-approve', 'Keep asking'],
            tool: 'approval_offer',
            input: { sentence: 'Approve test runs in C:/work/app', group: 'C:/work/app' },
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
              input: {
                folder: 'C:/work/app',
                apps: [
                  { id: 'lin', name: 'Linear' },
                  { id: 'mail', name: 'Mail' },
                ],
              },
            },
            relayed,
          );
        } else finish();
      } else if (msg.method === 'call') {
        // Home's tools: the permission pair and the jobs pair, kept in memory like the real brain.
        const params = msg.params as {
          tool?: string;
          input?: {
            tool?: string;
            mode?: string;
            job?: string;
            part?: string;
            after_rev?: number;
            id?: number;
            filter?: string;
            usd?: number;
            approved?: boolean;
            community_ok?: boolean;
            query?: string;
            app?: string;
            on?: boolean;
            until?: string;
          };
        };
        let value: unknown = {};
        if (params.tool === 'list_jobs') {
          // Like the brain: Scout's copy of a long result is cut with an ellipsis.
          value = {
            jobs: jobs.map((j) =>
              typeof j.scout_result === 'string' && j.scout_result.length > 1000
                ? { ...j, scout_result: `${j.scout_result.slice(0, 1000)}…` }
                : j,
            ),
          };
        } else if (params.tool === 'job_report') {
          value = { text: TWO_PART_REPORTS[`${params.input?.job}/${params.input?.part}`] ?? null };
        } else if (params.tool === 'job_activity') {
          // No job: the bubble's running steps (set by a test). A job: its steps after the cursor.
          const job = params.input?.job;
          if (job === undefined) value = { running };
          else {
            const rows = activity[job] ?? [];
            const row = jobs.find((j) => j.id === job);
            const after = Number(params.input?.after_rev ?? 0);
            const rev = rows.reduce((top, e) => Math.max(top, Number(e.rev)), 0);
            const entries = rows.filter((e) => Number(e.rev) > after);
            value = {
              job,
              state: jobs.find((j) => j.id === job)?.state ?? 'done',
              title: row?.title ?? null,
              started_at: row?.started_at ?? '2026-10-27T10:00:00Z',
              ended_at: row?.ended_at ?? null,
              closed_at: row?.closed_at ?? null,
              result: row?.scout_result ?? null,
              parts: ((row?.parts as Record<string, unknown>[] | undefined) ?? []).map((p) => ({
                id: p.id,
                expert: p.expert,
                state: p.state,
                reason: p.reason,
                started_at: p.started_at,
                ended_at: p.ended_at,
              })),
              rev,
              entries,
              more: false,
              watch: watches[job] ?? null,
            };
          }
        } else if (params.tool === 'stop_job') {
          stops.push(String(params.input?.job));
          const row = jobs.find((j) => j.id === params.input?.job);
          if (row !== undefined) {
            row.state = 'stopped';
            row.ended_at = '2026-10-27T10:00:30Z';
            for (const p of row.parts as Record<string, unknown>[]) p.state = 'stopped';
          }
          notify('changed', { what: 'jobs' });
        } else if (params.tool === 'key_status') {
          value = {
            has_key: hasKey,
            source: hasKey ? (options.environment === true ? 'environment' : 'file') : 'none',
            env_path: 'C:/Users/test/Tagalong/.env',
            daily_limit_usd: dailyLimitUsd,
          };
        } else if (params.tool === 'spend_today') {
          value = { spent_usd: 0.42, limit_usd: dailyLimitUsd };
        } else if (params.tool === 'set_api_key') {
          keyCalls.attempts += 1;
          const status = keyResults.length > 1 ? keyResults.shift() : keyResults[0];
          value = { status };
          if (status === 'ok') {
            hasKey = true;
            notify('changed', { what: 'key' });
          }
        } else if (params.tool === 'set_daily_limit') {
          dailyLimitUsd = Number(params.input?.usd);
          limits.push(dailyLimitUsd);
          notify('changed', { what: 'settings' });
        } else if (params.tool === 'setup_overview') {
          if (failSearches === 'hang' && String(params.input?.query ?? '') !== '') return;
          if (failSearches && String(params.input?.query ?? '') !== '') {
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32000, message: 'registry unreachable' },
              }),
            );
            return;
          }
          value = {
            experts: expertInstalled
              ? [
                  {
                    id: 'claude-acp',
                    name: 'Claude Code',
                    version: '2.0.0',
                    state: 'ready',
                    tested: true,
                    official: true,
                  },
                ]
              : [],
            // One installed Official app (Files), so Your apps shows the Official group.
            apps: [
              { id: 'files', name: 'Files', state: 'connected', official: true },
              ...(gmailConnected ? [{ id: 'a1', name: 'Gmail', state: 'connected' }] : []),
            ],
            // D5: curated experts first (Claude Code recommended), then what sits behind Show more.
            browse_experts: expertInstalled
              ? BROWSE_EXPERTS.filter((e) => e.id !== 'claude-acp')
              : BROWSE_EXPERTS,
            show_more_from: expertInstalled ? 1 : 2,
            // The registry answers a search by name; no query is a first page without Gmail.
            browse_apps:
              gmailConnected || !String(params.input?.query ?? '').includes('gmail')
                ? []
                : [{ id: 'io.example/gmail', name: 'Gmail', version: '1', description: 'Mail' }],
            // C1 facts: a search for notion is one service, an Official head and two community.
            popular: [notionRow('com.notion/mcp', true, 'Notion')],
            popular_more: [],
            app_groups: String(params.input?.query ?? '').includes('notion') ? [NOTION_GROUP] : [],
            next_cursor: null,
            sources: null,
            stale: false,
            progress: null,
            failed: null,
            ...setupPatch,
          };
        } else if (params.tool === 'bodies_status') {
          value = {
            bodies: [
              { kind: 'desktop', name: 'Desktop', connected: true },
              { kind: 'browser', name: 'Browser', connected: true },
              { kind: 'whatsapp', name: 'WhatsApp', connected: false },
            ],
          };
        } else if (params.tool === 'whatsapp_status') {
          value = {
            enabled: false,
            set: {
              access_token: false,
              app_secret: false,
              verify_token: false,
              phone_number_id: false,
              allowed_number: false,
            },
            complete: false,
            state: 'off',
            port: 8080,
          };
        } else if (params.tool === 'setup_app') {
          appSetups.push(String(params.input?.id));
          appFlags.push({
            approved: params.input?.approved,
            communityOk: params.input?.community_ok,
          });
          gmailConnected = true;
          notify('changed', { what: 'setup' });
        } else if (params.tool === 'setup_expert') {
          expertSetups.push(String(params.input?.id));
          expertApprovals.push(params.input?.approved);
          expertInstalled = true;
          notify('changed', { what: 'setup' });
        } else if (params.tool === 'list_memories') {
          value = {
            memories: [
              { id: 'm1', kind: 'summary', text: LONG_FACT, at: '2026-10-27T10:00:00Z' },
              { id: 'm2', kind: 'fact', text: 'Prefers green tea', at: '2026-10-26T10:00:00Z' },
            ],
          };
        } else if (params.tool === 'list_apps') value = { apps: APPS };
        else if (params.tool === 'list_approvals') {
          const filter = params.input?.filter;
          const rows = APPROVALS.filter((r) =>
            filter === 'scout'
              ? r.decided_by === 'scout'
              : filter === 'refused'
                ? r.outcome === 'refused'
                : true,
          );
          const counts = {
            total: APPROVALS.length,
            scout: APPROVALS.filter((r) => r.decided_by === 'scout').length,
            refused: APPROVALS.filter((r) => r.outcome === 'refused').length,
          };
          value = { approvals: rows, counts, next: null };
        } else if (params.tool === 'list_preferences') value = { preferences };
        else if (params.tool === 'remove_preference') {
          removedPreferences.push(Number(params.input?.id));
          const at = preferences.findIndex((p) => p.id === params.input?.id);
          if (at >= 0) preferences.splice(at, 1);
          notify('changed', { what: 'approvals' });
        } else if (params.tool === 'brain_status' && options.brainStatus !== undefined) {
          value = options.brainStatus;
        } else if (params.tool === 'reading_status') value = { rows: readingRows };
        else if (params.tool === 'timers_state') value = { timers };
        else if (params.tool === 'timer_cancel') {
          timerCancels.push(String(params.input?.id));
          timers = timers.filter((t) => t.id !== params.input?.id);
          notify('changed', { what: 'timers' });
        } else if (params.tool === 'loops_state') value = { apps: loopApps, loops: heldLoops };
        else if (params.tool === 'loops_set') {
          const on = params.input?.on === true;
          loopCalls.push(`set ${String(params.input?.app)} ${on ? 'on' : 'off'}`);
          for (const app of loopApps) app.on = on;
          if (on && heldLoops.length === 0) {
            heldLoops = [
              {
                id: 'l1',
                app: 'gmail',
                title: 'Send Priya the Q4 deck',
                asks: 'Wants the pricing slide updated',
                direction: 'i_owe',
                due: '2026-11-06T09:00:00+00:00',
                people: ['Priya'],
                status: 'held',
              },
            ];
          }
          notify('changed', { what: 'loops' });
        } else if (params.tool === 'loop_forget') {
          loopCalls.push(`forget ${String(params.input?.id)}`);
          heldLoops = heldLoops.filter((l) => l.id !== params.input?.id);
          notify('changed', { what: 'loops' });
        } else if (params.tool === 'loop_done' || params.tool === 'loop_later') {
          const id = String(params.input?.id);
          loopCalls.push(
            params.tool === 'loop_done'
              ? `done ${id}`
              : `later ${id} ${String(params.input?.until)}`,
          );
          heldLoops = heldLoops.map((l) =>
            l.id === id ? { ...l, status: params.tool === 'loop_done' ? 'done' : 'snoozed' } : l,
          );
          notify('changed', { what: 'loops' });
        } else if (params.tool === 'loops_wipe') {
          loopCalls.push('wipe');
          heldLoops = [];
          for (const app of loopApps) app.on = false;
          notify('changed', { what: 'loops' });
        } else if (params.tool === 'list_permissions')
          value = { tools: permissions, groups: permissionGroups };
        else if (params.tool === 'set_permission') {
          const row = permissions.find((p) => p.name === params.input?.tool);
          const chosen = String(params.input?.mode);
          permissionSets.push({ tool: String(params.input?.tool), mode: chosen });
          if (chosen === 'auto' && (row?.person_only === true || row?.self_asks === true)) {
            // Like the real brain: a tool that always asks never goes to Auto.
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32602, message: `${String(params.input?.tool)} always asks.` },
              }),
            );
            return;
          }
          if (row !== undefined) row.mode = chosen;
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
          ...(Array.isArray(msg.params?.apps) ? { apps: msg.params.apps } : {}),
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
    loopCalls,
    timerCancels,
    setTimers: (rows) => {
      timers = rows;
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'changed',
            params: { seq: ++seq, what: 'timers' },
          }),
        );
      }
    },
    setSetup: (patch, failing = false) => {
      setupPatch = patch;
      failSearches = failing;
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'changed',
            params: { seq: ++seq, what: 'setup' },
          }),
        );
      }
    },
    readingEvents,
    setReading: (rows) => {
      readingRows = rows;
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'changed',
            params: { seq: ++seq, what: 'reading' },
          }),
        );
      }
    },
    get keyAttempts() {
      return keyCalls.attempts;
    },
    limits,
    stops,
    expertSetups,
    expertApprovals,
    appSetups,
    appFlags,
    removedPreferences,
    voice,
    pushActivity: (job, entry) => {
      const rows = (activity[job] ??= []);
      const rev = rows.reduce((top, e) => Math.max(top, Number(e.rev)), 0) + 1;
      rows.push({
        rev,
        seq: rev,
        at: '2026-10-27T10:00:06Z',
        status: null,
        step: null,
        exit: null,
        part: 'p1',
        source: null,
        ...entry,
      });
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'changed',
            params: { seq: ++seq, what: 'job_activity' },
          }),
        );
      }
    },
    setWatch: (job, items) => {
      watches[job] = items;
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'changed',
            params: { seq: ++seq, what: 'job_activity' },
          }),
        );
      }
    },
    setRunning: (steps, what) => {
      running = steps;
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', method: 'changed', params: { seq: ++seq, what } }),
        );
      }
    },
    hear: (event, text) => {
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'heard',
            params: { event, ...(text === undefined ? {} : { text }) },
          }),
        );
      }
    },
    sendApproved: (note) => {
      for (const socket of sockets) {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', method: 'approved', params: { seq: ++seq, ...note } }),
        );
      }
    },
    sendRemark: (text) => {
      const turn = `t${++turns}`;
      const base = { turn, body: 'desktop' };
      const frames: [string, Record<string, unknown>][] = [
        ['turn', { ...base, state: 'started', started_by: 'brain' }],
        ['reply', { ...base, delta: text }],
        ['reply', { ...base, done: true }],
        ['turn', { ...base, state: 'ended', reason: 'done' }],
      ];
      for (const [method, params] of frames) {
        for (const socket of sockets) {
          socket.send(
            JSON.stringify({ jsonrpc: '2.0', method, params: { seq: ++seq, ...params } }),
          );
        }
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}
