/**
 * The desktop's end of contract v1: one websocket to the brain, hello first, then say,
 * cancel and the brain's notifications and `use` requests. It owns reconnecting and
 * replay (last_seq); what the notifications mean is the caller's job.
 */
import {
  CallResult,
  ErrorCode,
  HelloResult,
  PROTOCOL,
  SayResult,
  UseParams,
  brainToBody,
  type Part,
  type SayParams,
  type Tool,
} from '@tagalong/contract';

export type BrainStatus = 'connecting' | 'online' | 'offline' | 'outdated';

export interface BrainSocket {
  send(data: string): void;
  close(): void;
  onOpen(f: () => void): void;
  onMessage(f: (data: string) => void): void;
  onClose(f: () => void): void;
}

export interface BrainClientOptions {
  /** "host:port" */
  addr: string;
  /** Body tools, sent in hello. */
  tools: () => Tool[];
  openSocket: (url: string) => BrainSocket;
  /** Brain notifications that passed their schema. */
  onNotification: (method: string, params: unknown) => void;
  onUse: (tool: string, input: Record<string, unknown>, call: string) => Promise<Part[]>;
  onStatus: (status: BrainStatus) => void;
  /** The brain could not replay what was missed; drop what open turns were showing. */
  onResync: () => void;
  retryMs?: number;
}

export class BrainOffline extends Error {
  constructor() {
    super('brain offline');
    this.name = 'BrainOffline';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const BODY = { id: 'desktop', kind: 'desktop', name: 'Desktop' };

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrainClient {
  private sessionId: string | null = null;
  private socket: BrainSocket | null = null;
  private status: BrainStatus | null = null;
  private stopped = true;
  private nextId = 1;
  private lastSeq: number | null = null;
  private pending = new Map<string, Pending>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: BrainClientOptions) {}

  get session(): string | null {
    return this.sessionId;
  }

  /** "host:port" the client dials, for the Home card that says where the brain is. */
  get addr(): string {
    return this.options.addr;
  }

  /** Where the link stands now; offline until start() has tried. */
  get link(): BrainStatus {
    return this.status ?? 'offline';
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.failPending();
    this.socket?.close();
    this.socket = null;
    if (this.status !== 'outdated') this.setStatus('offline');
  }

  say(params: SayParams): Promise<SayResult> {
    if (this.status !== 'online') return Promise.reject(new BrainOffline());
    return this.request('say', params).then((r) => {
      const parsed = SayResult.safeParse(r);
      if (!parsed.success) throw new Error('brain sent a bad say result');
      return parsed.data;
    });
  }

  cancel(turn: string): void {
    if (this.status !== 'online') return;
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', method: 'cancel', params: { turn } }));
  }

  /**
   * Runs one of the brain's own tools for Home (list_memories, spend_today, ...) and resolves
   * with its output parts. Rejects BrainOffline when not online, RpcError on a brain error.
   */
  call(tool: string, input: Record<string, unknown> = {}): Promise<Part[]> {
    if (this.status !== 'online') return Promise.reject(new BrainOffline());
    return this.request('call', { tool, input }).then((r) => {
      const parsed = CallResult.safeParse(r);
      if (!parsed.success) throw new Error('brain sent bad call result');
      return parsed.data.output;
    });
  }

  /** The person's click on an ask. Rejects when the brain is offline or the ask already closed. */
  answer(ask: string, decision: 'once' | 'always' | 'deny'): Promise<void> {
    if (this.status !== 'online') return Promise.reject(new BrainOffline());
    // The card says once; the contract's option is allow.
    const option = decision === 'once' ? 'allow' : decision;
    return this.request('answer', { ask, option }).then(() => undefined);
  }

  /** The answer to a job's ask: one of its own option names, or typed text for a question. */
  answerWith(ask: string, option: string, text?: string): Promise<void> {
    if (this.status !== 'online') return Promise.reject(new BrainOffline());
    const params = text === undefined ? { ask, option } : { ask, option, text };
    return this.request('answer', params).then(() => undefined);
  }

  private setStatus(status: BrainStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus(status);
  }

  private connect(): void {
    this.setStatus('connecting');
    const socket = this.options.openSocket(`ws://${this.options.addr}`);
    this.socket = socket;
    // A superseded socket may still fire late events; they must not touch current state.
    socket.onOpen(() => this.socket === socket && this.hello());
    socket.onMessage((data) => this.socket === socket && this.receive(data));
    socket.onClose(() => this.socket === socket && this.closed());
  }

  private hello(): void {
    const params = {
      protocol: PROTOCOL,
      body: BODY,
      tools: this.options.tools(),
      ...(this.lastSeq === null ? {} : { last_seq: this.lastSeq }),
    };
    // Handled inline, not in a promise callback: frames that follow the hello result in
    // the same tick must already see the new lastSeq and status.
    this.send(
      'hello',
      params,
      (r) => {
        const parsed = HelloResult.safeParse(r);
        if (!parsed.success) return this.socket?.close();
        this.sessionId = parsed.data.session;
        if (parsed.data.resync) {
          // The old numbering is gone; continue from the brain's latest.
          this.lastSeq = parsed.data.seq;
          this.options.onResync();
        }
        this.setStatus('online');
      },
      (e) => {
        if (e instanceof RpcError && e.code === ErrorCode.version_mismatch) {
          this.stopped = true;
          this.setStatus('outdated');
        }
        this.socket?.close();
      },
    );
  }

  private closed(): void {
    this.socket = null;
    this.failPending();
    if (this.status !== 'outdated') this.setStatus('offline');
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => this.connect(), this.options.retryMs ?? 2000);
  }

  private failPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new BrainOffline());
    }
    this.pending.clear();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => this.send(method, params, resolve, reject));
  }

  private send(
    method: string,
    params: unknown,
    resolve: (result: unknown) => void,
    reject: (error: Error) => void,
  ): void {
    const id = `desktop-${this.nextId++}`;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(id, { resolve, reject, timer });
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  }

  private receive(data: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (typeof m.method === 'string') {
      if (m.method === 'use') {
        if (typeof m.id === 'string' || typeof m.id === 'number') void this.use(m.id, m.params);
      } else if (m.id === undefined) this.notification(m.method, m.params);
    } else if (typeof m.id === 'string') {
      this.response(m.id, m.result, m.error);
    }
  }

  private response(id: string, result: unknown, error: unknown): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const e = error as { code?: unknown; message?: unknown } | undefined;
    if (e) p.reject(new RpcError(typeof e.code === 'number' ? e.code : 0, String(e.message ?? '')));
    else p.resolve(result);
  }

  private notification(method: string, params: unknown): void {
    // `cancel` carries no seq and nothing here is cancellable yet.
    if (method === 'cancel' || !(method in brainToBody)) return;
    const schema = brainToBody[method as keyof typeof brainToBody].params;
    const parsed = schema.safeParse(params);
    if (!parsed.success) return;
    const { seq } = parsed.data as { seq: number };
    if (this.lastSeq !== null && seq <= this.lastSeq) return;
    this.lastSeq = seq;
    this.options.onNotification(method, parsed.data);
  }

  private async use(id: string | number, params: unknown): Promise<void> {
    // Ids are per connection: an answer that outlives its socket must not reach the next one.
    const socket = this.socket;
    const parsed = UseParams.safeParse(params);
    if (!parsed.success)
      return this.reply(id, undefined, ErrorCode.invalid_params, 'invalid params');
    const { call, tool, input } = parsed.data;
    if (!this.options.tools().some((t) => t.name === tool)) {
      return this.reply(id, undefined, ErrorCode.unknown_tool, 'unknown tool');
    }
    try {
      const output = await this.options.onUse(tool, input, call);
      if (this.socket === socket) this.reply(id, { output });
    } catch (error) {
      if (this.socket !== socket) return;
      // A tool that names its failure (timeout, a refusal with its sentence) keeps it.
      // The contract allows only these codes for a failed use; anything else is tool_failed.
      const allowed: number[] = [
        ErrorCode.tool_failed,
        ErrorCode.cancelled,
        ErrorCode.timeout,
        ErrorCode.invalid_params,
      ];
      if (error instanceof RpcError) {
        const code = allowed.includes(error.code) ? error.code : ErrorCode.tool_failed;
        this.reply(id, undefined, code, error.message);
      } else this.reply(id, undefined, ErrorCode.tool_failed, 'tool failed');
    }
  }

  private reply(id: string | number, result?: unknown, code?: number, message?: string): void {
    const body = code === undefined ? { result } : { error: { code, message } };
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, ...body }));
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
