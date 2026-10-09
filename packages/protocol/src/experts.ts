import { z } from 'zod';

/**
 * Experts do the work a companion hands them. Each one is a connection to a tool the user
 * already has: Claude Code first, model APIs and tool servers later. The connection holds
 * no secrets; Claude Code signs itself in, and keys for later connectors go to the keychain.
 */
export const ClaudeCodeConnection = z.object({
  type: z.literal('claude-code'),
  /** The one folder the expert may work in. */
  folder: z.string().min(1),
  /** False keeps it to reading and searching. */
  canEdit: z.boolean().default(false),
  /** Defaults to `claude` on the PATH. */
  command: z.string().min(1).optional(),
});

export const ExpertConnection = z.discriminatedUnion('type', [ClaudeCodeConnection]);
export type ExpertConnection = z.infer<typeof ExpertConnection>;

export const Expert = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'an expert id is kebab-case'),
  name: z.string().min(1).max(60),
  /** What the companion reads when it picks an expert for a task. */
  goodAt: z.string().max(500).default(''),
  enabled: z.boolean().default(true),
  connection: ExpertConnection,
});
export type Expert = z.infer<typeof Expert>;

/** What a companion sends an expert: the ask in the user's words and what they were looking at. */
export const Brief = z.object({
  ask: z.string().min(1),
  context: z
    .object({
      app: z.string().optional(),
      windowTitle: z.string().optional(),
      selection: z.string().optional(),
    })
    .optional(),
  /** Paths that matter, relative to the expert's folder where they can be. */
  files: z.array(z.string().min(1)).optional(),
  /** What a good answer looks like, so the expert knows when it is done. */
  goodAnswer: z.string().optional(),
});
export type Brief = z.infer<typeof Brief>;

export const ExpertsListParams = z.object({});
export const ExpertsListResult = z.object({ experts: z.array(Expert) });

export const ExpertsUpsertParams = z.object({ expert: Expert });
export const ExpertsUpsertResult = z.object({ expert: Expert });

export const ExpertsDeleteParams = z.object({ expertId: z.string().min(1) });
export const ExpertsDeleteResult = z.object({ deleted: z.boolean() });

/** Whether the expert can be reached, without spending anything: Claude Code's `--version`. */
export const ExpertsTestParams = z.object({ expertId: z.string().min(1) });
export const ExpertsTestResult = z.object({
  ok: z.boolean(),
  /** Why not, in words the user can act on. */
  error: z.string().optional(),
});

/** A companion hands a brief to an expert. Progress and the result arrive as notifications. */
export const HandoffsStartParams = z.object({
  expertId: z.string().min(1),
  /** The companion handing off. */
  petId: z.string().min(1),
  brief: Brief,
});
export const HandoffsStartResult = z.object({ handoffId: z.uuid() });

export const HandoffsCancelParams = z.object({ handoffId: z.uuid() });
export const HandoffsCancelResult = z.object({ cancelled: z.boolean() });

/** A short step while the expert works, such as "Reading src/main.ts". */
export const HandoffProgressParams = z.object({
  handoffId: z.uuid(),
  expertId: z.string().min(1),
  step: z.string().min(1),
});

export const HandoffFinishedParams = z.object({
  handoffId: z.uuid(),
  expertId: z.string().min(1),
  state: z.enum(['done', 'error', 'stopped']),
  text: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type HandoffFinishedParams = z.infer<typeof HandoffFinishedParams>;
