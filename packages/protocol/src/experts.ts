import { z } from 'zod';

/**
 * Experts do the work a companion hands them. Each one is a connection to a tool the user
 * already has: Claude Code first, model APIs and tool servers later. The connection holds
 * no secrets; Claude Code signs itself in, and keys for later connectors go to the keychain.
 */
export const ClaudeCodeConnection = z.object({
  type: z.literal('claude-code'),
  /**
   * The project a running hand-off works in, filled in when the person confirms it. No
   * longer a saved setting: an old expert's default folder still parses but is ignored.
   */
  folder: z.string().min(1).optional(),
  /** False keeps it to reading and searching. */
  canEdit: z.boolean().default(false),
  /** True also lets it search and fetch the web. Off unless the person turns it on. */
  canSearchWeb: z.boolean().default(false),
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
  /** Standing instructions: what the expert is told on every task, added to its own prompt. */
  instructions: z.string().max(4000).default(''),
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

/** A folder that may be the project a task is about, and why it was suggested. */
export const ProjectCandidate = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  /** screen: named in the window; remembered: used before; found: a project on this computer. */
  reason: z.enum(['screen', 'remembered', 'found']),
});
export type ProjectCandidate = z.infer<typeof ProjectCandidate>;

/**
 * A companion wrote a brief for an expert. Nothing runs until the person confirms it, with
 * the project it should work in: `projects` holds the guesses, best first.
 */
export const HandoffProposedParams = z.object({
  proposalId: z.uuid(),
  petId: z.string().min(1),
  expertId: z.string().min(1),
  expertName: z.string().min(1),
  brief: Brief,
  projects: z.array(ProjectCandidate),
  canEdit: z.boolean(),
});
export type HandoffProposedParams = z.infer<typeof HandoffProposedParams>;

/** The person sends a proposed hand-off, in the folder they settled on. */
export const HandoffsConfirmParams = z.object({
  proposalId: z.uuid(),
  folder: z.string().min(1),
  canEdit: z.boolean(),
  /** The brief as the person edited it, if they did. */
  brief: Brief.optional(),
});
export const HandoffsConfirmResult = z.object({ handoffId: z.uuid() });

export const HandoffsDismissParams = z.object({ proposalId: z.uuid() });
export const HandoffsDismissResult = z.object({ dismissed: z.boolean() });

/** Projects on this computer whose name or path matches, for "Change project". */
export const ProjectsSearchParams = z.object({ query: z.string().max(200) });
export const ProjectsSearchResult = z.object({ projects: z.array(ProjectCandidate) });
