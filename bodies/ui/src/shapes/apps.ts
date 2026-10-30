/**
 * The brain's apps (Notion, GitHub, a local tool reached over MCP) as Home shows them, and
 * the confirm card an app change raises. Contains AppInfo, AppsList, AppAddParams,
 * ConnectionStatus, ConnectorConfirmParams and ConnectorDismissParams, shaped after the
 * brain's list_apps and add_app (brain/src/brain/app_tools.py).
 */
import { z } from 'zod';

export const ConnectionStatus = z.enum([
  'off',
  'connecting',
  'connected',
  'needs-sign-in',
  'error',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

// Flat on purpose: the brain takes command/url/token as top-level fields, not a nested transport.
const AppTransport = z.enum(['stdio', 'http']);
const AppAuth = z.enum(['none', 'token', 'oauth']);

const AppToolInfo = z.object({
  name: z.string().min(1),
  effect: z.string(),
  /** A locked tool never offers "always allow". */
  locked: z.boolean(),
});

export const AppInfo = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: AppTransport,
  auth: AppAuth,
  enabled: z.boolean(),
  status: ConnectionStatus,
  /** Empty when nothing is wrong. */
  error: z.string(),
  /** Where it runs: `url` for http, `command` and `args` for stdio. Never env, headers or tokens. */
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  tools: z.array(AppToolInfo),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const AppsList = z.object({ apps: z.array(AppInfo) });
export type AppsList = z.infer<typeof AppsList>;

export const AppAddParams = z
  .object({
    name: z.string().min(1).max(60),
    transport: AppTransport,
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().min(1).optional(),
    auth: AppAuth.default('none'),
    token: z.string().min(1).optional(),
  })
  .superRefine((p, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(p.transport !== 'stdio' || !!p.command, 'command', 'a local app needs a command');
    need(p.transport !== 'http' || !!p.url, 'url', 'a remote app needs an address');
    need(p.auth !== 'token' || p.transport === 'http', 'auth', 'a token only works with http');
    need(p.auth !== 'token' || !!p.token, 'token', 'token sign-in needs the token');
    need(p.auth === 'token' || p.token === undefined, 'token', 'a token only goes with auth token');
  });
export type AppAddParams = z.input<typeof AppAddParams>;

/**
 * Scout wants to change something in an app. Nothing runs until the person answers: `once`
 * runs it this one time, `deny` cancels it.
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
  risk: z.enum(['read', 'change', 'high']).optional(),
  /** The brain's ask options, in order (`allow`, `always`, `deny`; no `always` on a locked tool). */
  options: z.array(z.string()).optional(),
  /** A Claude Code job asks the person something: the card takes typed text as well as a choice. */
  question: z.boolean().optional(),
});
export type ConnectorConfirmParams = z.infer<typeof ConnectorConfirmParams>;

/** A confirm card's ask closed (answered, timed out, cancelled): the bubble drops the card. */
export const ConnectorDismissParams = z.object({ approvalId: z.string().min(1) });
export type ConnectorDismissParams = z.infer<typeof ConnectorDismissParams>;
