import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  ContextSnapshotPatch,
  ENGINE_HOST,
  HelloParams,
  PROTOCOL_VERSION,
  PerceptionCaptureRegionResult,
  PerceptionCaptureWindowResult,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionListWindowsResult,
  PerceptionReadTextResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  RPC_ERROR_CODES,
  RpcRequest,
  hostToCoreMethods,
  notificationParamsSchemaFor,
  paramsSchemaFor,
} from '@tagalong/protocol';
import type {
  PerceptionDiffParams as PerceptionDiffParamsType,
  PerceptionDiffResult as PerceptionDiffResultType,
  PerceptionRecallParams as PerceptionRecallParamsType,
  PerceptionRecallResult as PerceptionRecallResultType,
  CoreToHostNotification,
  HostCapability,
  PerceptionCaptureRegionParams,
  PerceptionCaptureWindowParams,
  PerceptionCaptureRegionResult as PerceptionCaptureRegionResultType,
  PerceptionListWindowsResult as PerceptionListWindowsResultType,
  PerceptionReadTextParams,
  PerceptionReadTextResult as PerceptionReadTextResultType,
  HostKind,
  NotificationParamsOf,
  ParamsOf,
  PerceptionTarget,
  Pet,
  ResultOf,
  RpcId,
} from '@tagalong/protocol';
import { tokensMatch } from './pairing';

/**
 * A handler's refusal that carries its own JSON-RPC code, such as `invalidParams` for a
 * request that parsed but names something that does not exist. Any other throw is an
 * `internalError`.
 */
export class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcFailure';
  }
}

/** A connected host, from the engine's point of view. */
export interface HostSession {
  readonly id: string;
  readonly host: HostKind;
  readonly capabilities: readonly HostCapability[];
  /** Fire-and-forget push to this host. */
  notify<N extends CoreToHostNotification>(method: N, params: NotificationParamsOf<N>): void;
  /** Asks the host to perceive something and waits for its answer. */
  capture(what: readonly PerceptionTarget[]): Promise<ContextSnapshotPatch>;
  /**
   * Asks the host for the text of one window.
   *
   * One window, never a list. Reading the whole desktop's text would be about 11,600
   * tokens on an ordinary twelve-window session, which is why the pet reads the ~300
   * token inventory first and names the window it actually wants.
   */
  readText(params: ReadTextParams): Promise<ReadTextReading>;
  /** Asks the host for the window inventory: what each window is and where, never its text. */
  listWindows(): Promise<PerceptionListWindowsResultType>;
  /** Asks the host for a native-resolution crop of one display, for leaning in. */
  captureRegion(params: CaptureRegionParams): Promise<PerceptionCaptureRegionResultType>;
  /** Asks the host for a screenshot of one listed window, in front or not. */
  captureWindow(params: PerceptionCaptureWindowParams): Promise<PerceptionCaptureWindowResult>;
  /** Phase 3B. The buffered frame nearest a moment ago, from rolling memory. */
  recall(params: RecallParams): Promise<RecallResult>;
  /** Phase 3B. How a display, or a region of it, changed since a moment ago. */
  diff(params: DiffParams): Promise<DiffResult>;
}

export type RecallParams = PerceptionRecallParamsType;
export type RecallResult = PerceptionRecallResultType;
export type DiffParams = PerceptionDiffParamsType;
export type DiffResult = PerceptionDiffResultType;

/** What the engine asks for when a pet wants a closer look. */
export type CaptureRegionParams = PerceptionCaptureRegionParams;

/** What the engine asks for. `windowId` absent means the foreground window. */
export type ReadTextParams = PerceptionReadTextParams;
export type ReadTextReading = PerceptionReadTextResultType;

/** Everything a host may call, minus hello, which the server answers itself. */
export type MethodHandlers = {
  [M in Exclude<keyof typeof hostToCoreMethods, 'hello'>]?: (
    params: ParamsOf<M>,
    session: HostSession,
  ) => ResultOf<M> | Promise<ResultOf<M>>;
};

export interface EngineServerOptions {
  /** 0 lets the OS pick a free port, which is what the tests use. */
  port: number;
  token: string;
  engineVersion: string;
  listPets: () => Pet[];
  handlers: MethodHandlers;
  /** How long a connection may stay open without a hello. Defaults to 10 seconds. */
  helloTimeoutMs?: number;
}

/**
 * What the Chrome extension may call: what its side panel actually uses. The token is the
 * same for every host, so this is what keeps a compromised extension from changing
 * settings, approving tools, adding connections, routines or experts.
 */
export const EXTENSION_METHODS: ReadonlySet<string> = new Set([
  'ask',
  'interrupt',
  'pets.list',
  'roles.list',
  'roles.recommendModel',
  'notices.rolesUpgrade',
  'notices.dismiss',
]);

const HELLO_TIMEOUT_MS = 10_000;

/** A hello is a few hundred bytes; anything this big before one is not a host. */
const MAX_BYTES_BEFORE_HELLO = 64 * 1024;

/** How long the engine waits for a host to answer perception.capture. */
const CAPTURE_TIMEOUT_MS = 5_000;

interface Connection {
  readonly socket: WebSocket;
  session: SessionImpl | undefined;
}

class SessionImpl implements HostSession {
  readonly id = randomUUID();
  #nextRequestId = 1;
  readonly #pending = new Map<RpcId, (result: unknown, error?: unknown) => void>();

  constructor(
    readonly host: HostKind,
    readonly capabilities: readonly HostCapability[],
    readonly socket: WebSocket,
  ) {}

  notify<N extends CoreToHostNotification>(method: N, params: NotificationParamsOf<N>): void {
    // Validating on the way out turns a malformed notification into a loud engine-side
    // failure instead of a host that silently ignores a message it cannot parse.
    const validated = notificationParamsSchemaFor(method).parse(params);
    this.#send({ jsonrpc: '2.0', method, params: validated });
  }

  async capture(what: readonly PerceptionTarget[]): Promise<ContextSnapshotPatch> {
    const id = `capture-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.capture', { what });
    const result = raw as { snapshot?: unknown };
    return ContextSnapshotPatch.parse(result.snapshot ?? {});
  }

  async readText(params: ReadTextParams): Promise<ReadTextReading> {
    const id = `readText-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.readText', params);
    // Parsed rather than trusted: this crosses a socket, and a malformed reading that
    // reached the model would look to the user like the pet inventing screen contents.
    return PerceptionReadTextResult.parse(raw);
  }

  async captureWindow(
    params: PerceptionCaptureWindowParams,
  ): Promise<PerceptionCaptureWindowResult> {
    const id = `captureWindow-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.captureWindow', params);
    return PerceptionCaptureWindowResult.parse(raw);
  }

  async listWindows(): Promise<PerceptionListWindowsResultType> {
    const id = `listWindows-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.listWindows', {});
    return PerceptionListWindowsResult.parse(raw);
  }

  async captureRegion(params: CaptureRegionParams): Promise<PerceptionCaptureRegionResultType> {
    const id = `captureRegion-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.captureRegion', params);
    return PerceptionCaptureRegionResult.parse(raw);
  }

  async recall(params: RecallParams): Promise<RecallResult> {
    const id = `recall-${this.#nextRequestId++}`;
    const raw = await this.#request(id, 'perception.recall', PerceptionRecallParams.parse(params));
    return PerceptionRecallResult.parse(raw);
  }

  async diff(params: DiffParams): Promise<DiffResult> {
    const id = `diff-${this.#nextRequestId++}`;
    // Parsed on the way out too, so `includeImages` reaches the host with its default.
    const raw = await this.#request(id, 'perception.diff', PerceptionDiffParams.parse(params));
    return PerceptionDiffResult.parse(raw);
  }

  /** Resolves a core-to-host request the host has answered. */
  settle(id: RpcId, result: unknown, error: unknown): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    pending(result, error);
  }

  /** Fails every in-flight request; called when the socket goes away. */
  abandon(reason: string): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending(undefined, new Error(reason));
    }
  }

  #request(id: RpcId, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`host did not answer ${method} within ${CAPTURE_TIMEOUT_MS}ms`));
      }, CAPTURE_TIMEOUT_MS);

      this.#pending.set(id, (result, error) => {
        clearTimeout(timer);
        if (error !== undefined) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve(result);
      });

      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  #send(payload: unknown): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(payload));
  }
}

/**
 * The engine's side of the host protocol.
 *
 * Binds to loopback only, and every connection stays unauthenticated until it presents
 * the pairing token in hello. Loopback is not a permission boundary on its own: any
 * local process can open a socket, so the token is what keeps other programs out.
 */
export class EngineServer {
  readonly #wss: WebSocketServer;
  readonly #options: EngineServerOptions;
  readonly #connections = new Set<Connection>();

  private constructor(wss: WebSocketServer, options: EngineServerOptions) {
    this.#wss = wss;
    this.#options = options;
    wss.on('connection', (socket) => this.#accept(socket));
  }

  static start(options: EngineServerOptions): Promise<EngineServer> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: ENGINE_HOST, port: options.port });
      wss.once('error', reject);
      wss.once('listening', () => {
        wss.removeListener('error', reject);
        resolve(new EngineServer(wss, options));
      });
    });
  }

  /** The port actually bound, which matters when options.port was 0. */
  get port(): number {
    const address = this.#wss.address();
    return typeof address === 'object' && address !== null ? address.port : this.#options.port;
  }

  /** Sessions that completed the hello handshake. */
  sessions(): HostSession[] {
    return [...this.#connections]
      .map((c) => c.session)
      .filter((s): s is SessionImpl => s !== undefined);
  }

  broadcast<N extends CoreToHostNotification>(method: N, params: NotificationParamsOf<N>): void {
    for (const session of this.sessions()) session.notify(method, params);
  }

  close(): Promise<void> {
    for (const connection of this.#connections) {
      connection.session?.abandon('engine shutting down');
      connection.socket.terminate();
    }
    this.#connections.clear();
    return new Promise((resolve) => this.#wss.close(() => resolve()));
  }

  #accept(socket: WebSocket): void {
    const connection: Connection = { socket, session: undefined };
    this.#connections.add(connection);

    const helloTimer = setTimeout(() => {
      if (connection.session === undefined) socket.terminate();
    }, this.#options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    // Never what keeps the process alive at shutdown.
    helloTimer.unref();
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      if (connection.session === undefined && byteLength(raw) > MAX_BYTES_BEFORE_HELLO) {
        socket.terminate();
        return;
      }
      void this.#dispatch(connection, String(raw));
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      connection.session?.abandon('host disconnected');
      this.#connections.delete(connection);
    });
    // A transport error is not actionable here; dropping the connection is the whole
    // response, and the host reconnects.
    socket.on('error', () => this.#connections.delete(connection));
  }

  async #dispatch(connection: Connection, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#fail(connection.socket, null, RPC_ERROR_CODES.parseError, 'message was not valid JSON');
      return;
    }

    // A response to one of our own perception.capture requests.
    const asResponse = parsed as { id?: RpcId; result?: unknown; error?: unknown; method?: string };
    if (asResponse.method === undefined && asResponse.id !== undefined) {
      connection.session?.settle(asResponse.id, asResponse.result, asResponse.error);
      return;
    }

    const request = RpcRequest.safeParse(parsed);
    if (!request.success) {
      const id = (asResponse.id ?? null) as RpcId | null;
      this.#fail(connection.socket, id, RPC_ERROR_CODES.invalidRequest, 'not a JSON-RPC request');
      return;
    }

    const { id, method, params } = request.data;

    if (method === 'hello') {
      this.#hello(connection, id, params);
      return;
    }

    if (connection.session === undefined) {
      this.#fail(connection.socket, id, RPC_ERROR_CODES.unauthorized, 'send hello first');
      return;
    }

    if (!(method in hostToCoreMethods)) {
      this.#fail(connection.socket, id, RPC_ERROR_CODES.methodNotFound, `unknown method ${method}`);
      return;
    }

    if (connection.session.host === 'extension' && !EXTENSION_METHODS.has(method)) {
      this.#fail(
        connection.socket,
        id,
        RPC_ERROR_CODES.unauthorized,
        `${method} is not available to the extension`,
      );
      return;
    }

    const known = method as Exclude<keyof typeof hostToCoreMethods, 'hello'>;
    const parsedParams = paramsSchemaFor(known).safeParse(params ?? {});
    if (!parsedParams.success) {
      this.#fail(
        connection.socket,
        id,
        RPC_ERROR_CODES.invalidParams,
        describe(parsedParams.error),
      );
      return;
    }

    const handler = this.#options.handlers[known];
    if (handler === undefined) {
      this.#fail(
        connection.socket,
        id,
        RPC_ERROR_CODES.methodNotFound,
        `${method} is not wired up`,
      );
      return;
    }

    try {
      // `handler` is a union of per-method functions and `parsedParams.data` a union of
      // per-method params; TypeScript cannot see that this pair was indexed by the same
      // key. The catalog lookup above is what actually guarantees they match.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (handler as (p: unknown, s: HostSession) => any)(
        parsedParams.data,
        connection.session,
      );
      this.#respond(connection.socket, id, result);
    } catch (error) {
      // A handler that throws must still produce a response; a silent drop leaves the
      // host waiting forever on a promise that never settles.
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RpcFailure ? error.code : RPC_ERROR_CODES.internalError;
      this.#fail(connection.socket, id, code, message);
    }
  }

  #hello(connection: Connection, id: RpcId, params: unknown): void {
    const parsed = HelloParams.safeParse(params);
    if (!parsed.success) {
      this.#fail(connection.socket, id, RPC_ERROR_CODES.invalidParams, describe(parsed.error));
      return;
    }

    if (!tokensMatch(this.#options.token, parsed.data.token)) {
      this.#fail(connection.socket, id, RPC_ERROR_CODES.unauthorized, 'pairing token rejected');
      connection.session = undefined;
      this.#connections.delete(connection);
      // Close after the error has been flushed so the host can report what went wrong.
      connection.socket.close();
      return;
    }

    const session = new SessionImpl(parsed.data.host, parsed.data.capabilities, connection.socket);
    connection.session = session;
    this.#respond(connection.socket, id, {
      sessionId: session.id,
      engineVersion: this.#options.engineVersion,
      protocolVersion: PROTOCOL_VERSION,
      pets: this.#options.listPets(),
    });
  }

  #respond(socket: WebSocket, id: RpcId, result: unknown): void {
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, result: result ?? {} }));
  }

  #fail(socket: WebSocket, id: RpcId | null, code: number, message: string): void {
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }
}

function describe(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function byteLength(raw: Buffer | ArrayBuffer | Buffer[]): number {
  if (Array.isArray(raw)) return raw.reduce((total, part) => total + part.length, 0);
  return raw instanceof ArrayBuffer ? raw.byteLength : raw.length;
}
