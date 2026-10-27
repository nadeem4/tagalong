/**
 * Connections: the person's apps (Notion, GitHub, a local tool) reached over MCP, so Scout
 * can read them and, when the person allows it, change them.
 *
 * A connection is only its definition: no token, key or password is ever part of it. Those
 * live in the host's secret store under `connection.<id>.*`, and `secretNames` lists the
 * environment variables of a local command whose values are kept there.
 * Contains the Connection schemas, the `connections.*` and `connector.confirm` messages,
 * and connectionIdFrom.
 */
import { z } from 'zod';
import { AskRisk } from './asks';

/** Lower-case letters, digits and dashes: it prefixes the app's tool names, `notion__search`. */
export const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

function remoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    // Plain http only to this computer: a token sent in the clear to anywhere else is gone.
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export const ConnectionTransport = z.discriminatedUnion('type', [
  /** A remote server over Streamable HTTP. */
  z.object({
    type: z.literal('http'),
    url: z.string().refine(remoteUrl, 'use an https:// address'),
  }),
  /** A local server Tagalong starts: `command args`, with `env` added to its environment. */
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    /** Plain values and `${VAR}` references only; secret values are in the secret store. */
    env: z.record(z.string(), z.string()).default({}),
  }),
]);
export type ConnectionTransport = z.infer<typeof ConnectionTransport>;

/** oauth: the app's own sign-in in the browser. token: a key the person pasted. */
export const ConnectionAuth = z.enum(['oauth', 'token', 'none']);
export type ConnectionAuth = z.infer<typeof ConnectionAuth>;

export const Connection = z.object({
  id: z.string().regex(CONNECTION_ID),
  name: z.string().min(1).max(60),
  transport: ConnectionTransport,
  auth: ConnectionAuth,
  /** Environment variables of a local command whose values sit in the secret store. */
  secretNames: z.array(z.string().min(1)).default([]),
  /** Off: Scout gets none of its tools, and nothing connects. */
  enabled: z.boolean(),
});
export type Connection = z.infer<typeof Connection>;

/** read: only looks. write: changes something, so the person is asked first. */
export const ToolAccess = z.enum(['read', 'write']);
export type ToolAccess = z.infer<typeof ToolAccess>;

export const ConnectorTool = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  access: ToolAccess,
});
export type ConnectorTool = z.infer<typeof ConnectorTool>;

export const ConnectionStatus = z.enum([
  'off',
  'connecting',
  'connected',
  'needs-sign-in',
  'error',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

/** A connection as Home shows it: what it is, whether it works, and what it can do. */
export const ConnectionState = Connection.extend({
  status: ConnectionStatus,
  /** Why it is not connected, in words the person can act on. */
  error: z.string().optional(),
  tools: z.array(ConnectorTool),
});
export type ConnectionState = z.infer<typeof ConnectionState>;

/** An official remote server Home offers with one Connect button. */
export const PopularConnector = z.object({
  id: z.string().regex(CONNECTION_ID),
  name: z.string().min(1),
  url: z.string().url(),
  auth: z.enum(['oauth', 'token']),
  /** One line under the name: what Scout can do with it. */
  blurb: z.string().min(1),
  /** For `token`: what to paste, and where to make one. */
  tokenHint: z.string().optional(),
  tokenUrl: z.string().url().optional(),
});
export type PopularConnector = z.infer<typeof PopularConnector>;

/**
 * A server already set up in Claude Code on this computer. Values that may be secret were
 * not copied: `missingSecrets` names them, so Home can ask for each.
 */
export const FoundConnector = z.object({
  name: z.string().min(1),
  transport: ConnectionTransport,
  /** Claude Code's scope: `user`, or `local` to one project. */
  scope: z.enum(['user', 'local']),
  project: z.string().optional(),
  /** Env variables (local) or headers (remote) whose values were left behind. */
  missingSecrets: z.array(z.string().min(1)),
});
export type FoundConnector = z.infer<typeof FoundConnector>;

export const ConnectionsListParams = z.object({});
export const ConnectionsListResult = z.object({
  connections: z.array(ConnectionState),
  popular: z.array(PopularConnector),
  /** Claude Code's servers not yet added here. */
  found: z.array(FoundConnector),
});
export type ConnectionsListResult = z.infer<typeof ConnectionsListResult>;

/**
 * Adds a connection and connects it. An OAuth app opens the sign-in in the browser on its
 * own. `secrets` carries a pasted token (`token`) or a local command's env values; they go
 * straight to the secret store and never come back out.
 */
export const ConnectionsAddParams = z.object({
  name: z.string().min(1).max(60),
  transport: ConnectionTransport,
  auth: ConnectionAuth,
  /** Popular entries pass their own id, so `notion__search` is the same on every computer. */
  id: z.string().regex(CONNECTION_ID).optional(),
  secrets: z.record(z.string().min(1), z.string().min(1)).optional(),
});
export type ConnectionsAddParams = z.input<typeof ConnectionsAddParams>;
export const ConnectionsAddResult = z.object({ connection: ConnectionState });

export const ConnectionsSetEnabledParams = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export const ConnectionsSetEnabledResult = z.object({ connection: ConnectionState });

/** Opens the app's sign-in again: for `needs-sign-in`, or an expired session. */
export const ConnectionsSignInParams = z.object({ id: z.string().min(1) });
export const ConnectionsSignInResult = z.object({ connection: ConnectionState });

/** Disconnect: closes it, deletes its tokens and keys, and forgets it. */
export const ConnectionsRemoveParams = z.object({ id: z.string().min(1) });
export const ConnectionsRemoveResult = z.object({ removed: z.boolean() });

/** Every connection, whenever one connects, drops, or changes its tools. */
export const ConnectionsChangedParams = z.object({ connections: z.array(ConnectionState) });

/**
 * Scout wants to change something in an app. Nothing runs until the person answers with
 * `tool.approve`: `once` runs it this one time, `deny` cancels it.
 */
export const ConnectorConfirmParams = z.object({
  // Plain strings: the brain's ask ids are uuid hex, and an ask may have no turn ('').
  approvalId: z.string().min(1),
  turnId: z.string(),
  petId: z.string().min(1),
  app: z.string().min(1),
  tool: z.string().min(1),
  /** What will happen, in plain words: the tool's own line and what Scout filled in. */
  summary: z.string().min(1),
  /** `high`: it cannot be undone, and the card says so. */
  risk: AskRisk.optional(),
  /**
   * The brain's ask options, in order (`allow`, `always`, `deny`; no `always` on a locked
   * tool). Absent on the old brain's card, which offers Allow once and Deny only.
   */
  options: z.array(z.string()).optional(),
});
export type ConnectorConfirmParams = z.infer<typeof ConnectorConfirmParams>;

/**
 * A confirm card's ask closed (answered, timed out, cancelled). Only the bubble reads it:
 * unlike `asks.changed`, Home's waiting count and list ignore it.
 */
export const ConnectorDismissParams = z.object({ approvalId: z.string().min(1) });
export type ConnectorDismissParams = z.infer<typeof ConnectorDismissParams>;

/** A free id from a name: `Google Calendar` becomes `google-calendar`, then `-2`, `-3`. */
export function connectionIdFrom(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
      .replace(/-+$/, '') || 'app';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
