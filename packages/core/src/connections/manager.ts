/**
 * Runs the person's app connections: one MCP client per switched-on connection, sign-in,
 * tool calls with time limits, and the state Home shows. Contains ConnectionManager and the
 * transport types it is built from.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  connectionIdFrom,
  type AskRisk,
  type Connection,
  type ConnectionState,
  type ConnectionsAddParams,
  type ConnectorTool,
} from '@tagalong/protocol';
import type { SecretStore } from '../settings/settings';
import { accessOf, expandEnv, riskOf } from './access';
import { SecretOAuthProvider, oauthSecretKey, startLoopback } from './oauth';
import type { ConnectionStore } from './store';

/** What a transport is built from, besides the definition: the auth and the secret values. */
export interface TransportContext {
  /** For an `oauth` connection. */
  authProvider?: OAuthClientProvider | undefined;
  /** For a `token` connection: `Authorization: Bearer <token>`. */
  headers: Record<string, string>;
  /** A local command's env: the definition's, `${VAR}` filled in, plus its secret values. */
  env: Record<string, string>;
}

export type TransportFor = (
  connection: Connection,
  ctx: TransportContext,
) => Transport | Promise<Transport>;

/** One tool of a connected app, as the registry turns it into a Scout tool. */
export interface AppTool {
  connection: Connection;
  /** `risk`: how much asking a write needs (riskOf); `read` never asks. */
  tool: ConnectorTool & { inputSchema: Record<string, unknown>; risk: AskRisk };
}

export interface CallResult {
  ok: boolean;
  /** The app's answer, or why there is none, in words Scout can repeat. */
  text: string;
}

export interface ConnectionManagerOptions {
  store: ConnectionStore;
  secrets: SecretStore;
  /** Every connection's state, whenever one changes. */
  emit: (connections: ConnectionState[]) => void;
  /** Opens the system browser. The host owns it; absent, no sign-in can start. */
  openBrowser?: ((url: string) => void | Promise<void>) | undefined;
  /** Tests pass in-memory servers; the default speaks Streamable HTTP or stdio. */
  transportFor?: TransportFor | undefined;
  /** For `${VAR}` in a local command's env and args. */
  env?: Record<string, string | undefined> | undefined;
  callTimeoutMs?: number | undefined;
  connectTimeoutMs?: number | undefined;
  signInTimeoutMs?: number | undefined;
}

const CALL_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 20_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** An app's answer past this is cut: a whole database dump would swamp the turn. */
export const MAX_RESULT_CHARS = 8_000;

class Timeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Timeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split('\n', 1)[0] ?? '').slice(0, 200) || 'unknown error';
}

/** The secret-store keys a connection may own. */
function tokenKey(id: string): string {
  return `connection.${id}.token`;
}
function envKey(id: string, name: string): string {
  return `connection.${id}.env.${name}`;
}

function defaultTransport(connection: Connection, ctx: TransportContext): Transport {
  if (connection.transport.type === 'http') {
    // The SDK's own class types `sessionId` looser than its interface under exact optionals.
    return new StreamableHTTPClientTransport(new URL(connection.transport.url), {
      ...(ctx.authProvider ? { authProvider: ctx.authProvider } : {}),
      requestInit: { headers: ctx.headers },
    }) as Transport;
  }
  return new StdioClientTransport({
    command: connection.transport.command,
    args: connection.transport.args,
    env: { ...getDefaultEnvironment(), ...ctx.env },
    stderr: 'ignore',
  });
}

/** An MCP result as plain text: text and embedded text kept, pictures named, never sent. */
function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const parts: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content as { type: string; [key: string]: unknown }[]) {
    if (block.type === 'text' && typeof block['text'] === 'string') parts.push(block['text']);
    else if (block.type === 'resource') {
      const resource = block['resource'] as { text?: unknown; uri?: unknown } | undefined;
      if (typeof resource?.text === 'string') parts.push(resource.text);
      else if (typeof resource?.uri === 'string') parts.push(resource.uri);
    } else if (block.type === 'resource_link') {
      parts.push(`${String(block['name'] ?? '')} ${String(block['uri'] ?? '')}`.trim());
    } else if (block.type === 'image' || block.type === 'audio') {
      parts.push(`(the app sent ${block.type === 'image' ? 'an image' : 'audio'}, not shown)`);
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  const text = parts.join('\n');
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n(cut at ${MAX_RESULT_CHARS} characters)`;
}

interface Live {
  client: Client;
  tools: AppTool['tool'][];
}

/**
 * The person's connections, live. Each switched-on connection is one MCP client; a
 * connection that fails is an error on its own row and never stops the others or a turn.
 * Tokens and keys go to the secret store and are read back only to connect.
 */
export class ConnectionManager {
  readonly #live = new Map<string, Live>();
  readonly #status = new Map<string, Pick<ConnectionState, 'status' | 'error'>>();
  readonly #transportFor: TransportFor;

  constructor(private readonly options: ConnectionManagerOptions) {
    this.#transportFor = options.transportFor ?? defaultTransport;
  }

  /** Connects every switched-on connection. Resolves once each has connected or failed. */
  async start(): Promise<void> {
    await Promise.all(
      this.options.store
        .list()
        .filter((c) => c.enabled)
        .map((c) => this.#connect(c)),
    );
  }

  list(): ConnectionState[] {
    return this.options.store.list().map((c) => this.#state(c));
  }

  /** Every tool of every connected, switched-on app. */
  tools(): AppTool[] {
    return this.options.store.list().flatMap((connection) => {
      const live = connection.enabled ? this.#live.get(connection.id) : undefined;
      return live === undefined ? [] : live.tools.map((tool) => ({ connection, tool }));
    });
  }

  async add(params: ConnectionsAddParams): Promise<ConnectionState> {
    const taken = this.options.store.list().map((c) => c.id);
    if (params.id !== undefined && taken.includes(params.id)) {
      throw new Error(`${params.name} is already connected.`);
    }
    const id = params.id ?? connectionIdFrom(params.name, taken);
    const secrets = params.secrets ?? {};
    const secretNames = Object.keys(secrets).filter((name) => name !== 'token');
    if (secrets['token'] !== undefined)
      await this.options.secrets.set(tokenKey(id), secrets['token']);
    for (const name of secretNames)
      await this.options.secrets.set(envKey(id, name), secrets[name]!);
    const connection = this.options.store.upsert({
      id,
      name: params.name,
      transport:
        params.transport.type === 'http'
          ? params.transport
          : {
              ...params.transport,
              args: params.transport.args ?? [],
              env: params.transport.env ?? {},
            },
      auth: params.auth,
      secretNames,
      enabled: true,
    });
    await this.#connect(connection);
    return this.#state(connection);
  }

  /**
   * Starts the sign-in and answers at once with `connecting`: the person may take minutes
   * in the browser, longer than a host waits for a reply. The end arrives as a change.
   */
  beginSignIn(id: string): ConnectionState {
    const connection = this.#must(id);
    this.#set(id, { status: 'connecting' });
    void this.signIn(id);
    return this.#state(connection);
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectionState> {
    const connection = this.options.store.upsert({ ...this.#must(id), enabled });
    if (enabled) await this.#connect(connection);
    else {
      await this.#close(id);
      this.#set(id, { status: 'off' });
    }
    return this.#state(connection);
  }

  /** The app's own sign-in, in the browser, back to a loopback address on this computer. */
  async signIn(id: string): Promise<ConnectionState> {
    const connection = this.#must(id);
    await this.#close(id);
    if (this.options.openBrowser === undefined) {
      this.#set(id, {
        status: 'needs-sign-in',
        error: `Tagalong could not open a browser to sign in to ${connection.name}.`,
      });
      return this.#state(connection);
    }
    const open = this.options.openBrowser;
    this.#set(id, { status: 'connecting' });
    const loopback = await startLoopback();
    try {
      const provider = new SecretOAuthProvider({
        secrets: this.options.secrets,
        connectionId: id,
        redirectUrl: loopback.redirectUrl,
        onRedirect: (url) => open(url.toString()),
      });
      await provider.forgetClient();
      const transport = await this.#transportFor(
        connection,
        await this.#context(connection, provider),
      );
      const client = new Client({ name: 'Tagalong', version: '1.0.0' });
      try {
        await withTimeout(client.connect(transport), this.#connectTimeout());
        await this.#keep(connection, client);
        return this.#state(connection);
      } catch (error) {
        if (!(error instanceof UnauthorizedError) || !provider.redirected) throw error;
      }
      const code = await loopback.code(
        () => provider.expectedState,
        this.options.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS,
      );
      await (transport as Transport & { finishAuth(code: string): Promise<void> }).finishAuth(code);
      await this.#connect(connection);
    } catch (error) {
      this.#set(
        id,
        error instanceof Error && error.message === 'sign-in timed out'
          ? {
              status: 'needs-sign-in',
              error: `Signing in to ${connection.name} did not finish. Try Sign in again.`,
            }
          : {
              status: 'error',
              error: `Could not sign in to ${connection.name}: ${firstLine(error)}`,
            },
      );
    } finally {
      loopback.close();
    }
    return this.#state(connection);
  }

  /** Disconnect: closed, every key and token deleted, and forgotten. */
  async remove(id: string): Promise<boolean> {
    const connection = this.options.store.get(id);
    if (connection === null) return false;
    await this.#close(id);
    await this.options.secrets.delete(tokenKey(id));
    await this.options.secrets.delete(oauthSecretKey(id));
    for (const name of connection.secretNames) await this.options.secrets.delete(envKey(id, name));
    this.options.store.delete(id);
    this.#status.delete(id);
    this.#emit();
    return true;
  }

  /** Runs one tool. Never throws: a refusal, a timeout or a dropped app is a plain answer. */
  async call(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallResult> {
    const connection = this.options.store.get(id);
    const app = connection?.name ?? id;
    const live = connection?.enabled ? this.#live.get(id) : undefined;
    if (live === undefined) {
      return {
        ok: false,
        text: `${app} is not connected right now. It can be reconnected in Home, Connections.`,
      };
    }
    const timeout = this.options.callTimeoutMs ?? CALL_TIMEOUT_MS;
    try {
      const result = await live.client.callTool({ name, arguments: args }, undefined, {
        timeout,
        ...(signal ? { signal } : {}),
      });
      const text = textOf(result);
      return result.isError === true
        ? { ok: false, text: `${app} said: ${text || 'it could not do that'}` }
        : { ok: true, text };
    } catch (error) {
      const timedOut = (error as { code?: unknown }).code === -32001 || error instanceof Timeout;
      return timedOut
        ? { ok: false, text: `${app} did not answer in time, so nothing came back.` }
        : { ok: false, text: `${app} could not do that: ${firstLine(error)}` };
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#live.keys()].map((id) => this.#close(id)));
  }

  async #connect(connection: Connection): Promise<void> {
    await this.#close(connection.id);
    this.#set(connection.id, { status: 'connecting' });
    let provider: SecretOAuthProvider | undefined;
    if (connection.auth === 'oauth') {
      provider = new SecretOAuthProvider({
        secrets: this.options.secrets,
        connectionId: connection.id,
      });
      await provider.load();
      if (!(await provider.hasTokens())) {
        this.#set(connection.id, { status: 'needs-sign-in' });
        return;
      }
    }
    try {
      const transport = await this.#transportFor(
        connection,
        await this.#context(connection, provider),
      );
      const client = new Client({ name: 'Tagalong', version: '1.0.0' });
      await withTimeout(client.connect(transport), this.#connectTimeout());
      await this.#keep(connection, client);
    } catch (error) {
      this.#set(connection.id, this.#failure(connection, error));
    }
  }

  #failure(connection: Connection, error: unknown): Pick<ConnectionState, 'status' | 'error'> {
    const app = connection.name;
    if (error instanceof UnauthorizedError) {
      return connection.auth === 'oauth'
        ? { status: 'needs-sign-in', error: `${app} wants you to sign in again.` }
        : {
            status: 'error',
            error: `${app} turned the key down. Disconnect, then connect with a new one.`,
          };
    }
    if (error instanceof Timeout)
      return { status: 'error', error: `${app} did not answer in time.` };
    return { status: 'error', error: `Could not connect to ${app}: ${firstLine(error)}` };
  }

  async #keep(connection: Connection, client: Client): Promise<void> {
    const listed = await withTimeout(client.listTools(), this.#connectTimeout());
    const tools = listed.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      access: accessOf(tool.annotations),
      risk: riskOf(tool.annotations, tool.name),
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    this.#live.set(connection.id, { client, tools });
    client.onclose = () => {
      if (this.#live.get(connection.id)?.client !== client) return;
      this.#live.delete(connection.id);
      this.#set(connection.id, {
        status: 'error',
        error: `The connection to ${connection.name} closed.`,
      });
    };
    this.#set(connection.id, { status: 'connected' });
  }

  async #context(
    connection: Connection,
    authProvider: OAuthClientProvider | undefined,
  ): Promise<TransportContext> {
    const headers: Record<string, string> = {};
    if (connection.auth === 'token') {
      const token = await this.options.secrets.get(tokenKey(connection.id));
      if (token !== null) headers['Authorization'] = `Bearer ${token}`;
    }
    const env: Record<string, string> = {};
    if (connection.transport.type === 'stdio') {
      const from = this.options.env ?? process.env;
      for (const [key, value] of Object.entries(connection.transport.env)) {
        env[key] = expandEnv(value, from);
      }
      for (const name of connection.secretNames) {
        const value = await this.options.secrets.get(envKey(connection.id, name));
        if (value !== null) env[name] = value;
      }
    }
    return { ...(authProvider ? { authProvider } : {}), headers, env };
  }

  async #close(id: string): Promise<void> {
    const live = this.#live.get(id);
    if (live === undefined) return;
    this.#live.delete(id);
    try {
      await live.client.close();
    } catch {
      // Already gone: closing is best effort.
    }
  }

  #connectTimeout(): number {
    return this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }

  #must(id: string): Connection {
    const connection = this.options.store.get(id);
    if (connection === null) throw new Error(`There is no connection '${id}'.`);
    return connection;
  }

  #set(id: string, status: Pick<ConnectionState, 'status' | 'error'>): void {
    this.#status.set(id, status);
    this.#emit();
  }

  #state(connection: Connection): ConnectionState {
    const known = this.#status.get(connection.id);
    const status = !connection.enabled ? 'off' : (known?.status ?? 'connecting');
    const live = connection.enabled ? this.#live.get(connection.id) : undefined;
    return {
      ...connection,
      status,
      ...(known?.error !== undefined && status !== 'connected' && status !== 'off'
        ? { error: known.error }
        : {}),
      tools: (live?.tools ?? []).map(({ inputSchema: _schema, risk: _risk, ...tool }) => tool),
    };
  }

  #emit(): void {
    this.options.emit(this.list());
  }
}
