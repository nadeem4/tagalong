/**
 * Experts: the back-office workers a companion hands tasks to. Today an expert is a
 * Claude Code connection; it holds no secrets, because Claude Code signs itself in.
 * Contains Expert, the built-in catalog shapes, Brief, and the `experts.*`, `handoffs.*`,
 * `handoff.*` and `projects.search` messages.
 */
import { z } from 'zod';

/** A Claude Code plugin as `claude plugin install` names it: `name@marketplace`. */
export const PluginId = z
  .string()
  .regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/, 'a plugin id is name@marketplace');

/**
 * One app tool an expert may call, exactly as Claude Code names it
 * (`mcp__<server>__<tool>`). Never a wildcard: an expert gets the tools it lists, no more.
 */
export const McpToolRule = z
  .string()
  .regex(/^mcp__[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+$/, 'an app tool is mcp__<server>__<tool>');

/** How Tagalong reaches a Claude Code expert. */
export const ClaudeCodeConnection = z.object({
  type: z.literal('claude-code'),
  /**
   * The project a running hand-off works in, filled in when the person confirms it. Not
   * saved with the expert: a saved value still parses but is ignored.
   */
  folder: z.string().min(1).optional(),
  /** False keeps it to reading and searching. */
  canEdit: z.boolean().default(false),
  /** True also lets it search and fetch the web. Off unless the person turns it on. */
  canSearchWeb: z.boolean().default(false),
  /** Defaults to `claude` on the PATH. */
  command: z.string().min(1).optional(),
  /**
   * A catalog expert's bundle: the Claude Code plugins it runs with (every other installed
   * plugin is off for its runs) and the exact app tools it may call. Empty for every other
   * expert, which stays sealed: no plugins, no apps.
   */
  plugins: z.array(PluginId).default([]),
  mcpTools: z.array(McpToolRule).default([]),
  /** `own`: works in a folder of Tagalong's own, never in the person's projects. */
  workspace: z.enum(['project', 'own']).default('project'),
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
  /** The catalog entry it was installed from. Only these experts may use plugins and apps. */
  catalogId: z.string().min(1).optional(),
});
export type Expert = z.infer<typeof Expert>;

/**
 * One ready-made expert in Tagalong's built-in catalog: what it is good at, the Claude Code
 * plugins it pins, the apps (the person's own Claude Code connectors) it may use, and what
 * it may do, in plain words.
 */
export const CatalogEntry = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1).max(60),
  /** One line on the card. */
  line: z.string().min(1),
  goodAt: z.string().max(500),
  instructions: z.string().max(4000),
  canEdit: z.boolean().default(false),
  canSearchWeb: z.boolean().default(false),
  workspace: z.enum(['project', 'own']).default('project'),
  plugins: z.array(z.object({ id: PluginId, name: z.string().min(1) })).default([]),
  apps: z
    .array(
      z.object({
        name: z.string().min(1),
        /** The server as Claude Code names it, such as `claude.ai Google Calendar`. */
        server: z.string().min(1),
        tools: z.array(McpToolRule).min(1),
        /** Used when it is set up in Claude Code; the expert works without it. */
        optional: z.boolean().default(true),
      }),
    )
    .default([]),
  /** The permission profile in plain words. */
  mayDo: z.string().min(1),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/** A catalog entry with what this computer has: each plugin installed or not, each app found. */
export const CatalogStatus = z.object({
  entry: CatalogEntry,
  plugins: z.array(z.object({ id: PluginId, name: z.string(), installed: z.boolean() })),
  apps: z.array(z.object({ name: z.string(), found: z.boolean(), optional: z.boolean() })),
});
export type CatalogStatus = z.infer<typeof CatalogStatus>;

export const ExpertsCatalogParams = z.object({});
export const ExpertsCatalogResult = z.object({ entries: z.array(CatalogStatus) });

/** Installs an entry's missing plugins with Claude Code's own `claude plugin install`. */
export const ExpertsInstallParams = z.object({ catalogId: z.string().min(1) });
export const ExpertsInstallResult = z.object({
  ok: z.boolean(),
  /** The plugins installed now. */
  installed: z.array(PluginId),
  /** Why not, in words the person can act on. */
  error: z.string().optional(),
});

/** What a companion sends an expert: the ask in the user's words and what they were looking at. */
export const Brief = z.object({
  ask: z.string().min(1),
  context: z
    .object({
      app: z.string().optional(),
      windowTitle: z.string().optional(),
      selection: z.string().optional(),
      /** The end of the window's text, read only when the person took a Stuck? offer. */
      windowText: z.string().max(4000).optional(),
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

/**
 * What a progress step is: a tool the expert used, a line it wrote (shown on the card, never
 * said aloud), or a note from the person, queued (`note`), passed on (`delivered`), or not
 * passed on because the run ended first (`dropped`). When `kind` is left out, the step is a tool step.
 */
export const HandoffStepKind = z.enum(['tool', 'say', 'note', 'delivered', 'dropped']);
export type HandoffStepKind = z.infer<typeof HandoffStepKind>;

/** A short step while the expert works, such as "Reading src/main.ts". */
export const HandoffProgressParams = z.object({
  handoffId: z.uuid(),
  expertId: z.string().min(1),
  step: z.string().min(1),
  kind: HandoffStepKind.optional(),
});

export const HandoffFinishedParams = z.object({
  handoffId: z.uuid(),
  expertId: z.string().min(1),
  state: z.enum(['done', 'error', 'stopped']),
  text: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  error: z.string().optional(),
  /** A chained hand-off: the follow-up step that started after this one, so the bubble follows it. */
  next: z
    .object({ handoffId: z.uuid(), expertId: z.string().min(1), expertName: z.string().min(1) })
    .optional(),
});
export type HandoffFinishedParams = z.infer<typeof HandoffFinishedParams>;
export type HandoffProgressParams = z.infer<typeof HandoffProgressParams>;

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
  /** True: the expert works in its own folder, so the card asks for no project. */
  ownFolder: z.boolean().optional(),
  /**
   * Opened again from Waiting on you after a restart: the window it was written from is not
   * kept, so the card says the expert gets only the brief shown.
   */
  restored: z.literal(true).optional(),
  /**
   * One follow-up step, such as a Reviewer checking what a Coder changed. It runs after the
   * first step finishes well, in the same folder, with the first step's answer in its brief.
   */
  then: z
    .object({
      expertId: z.string().min(1),
      expertName: z.string().min(1),
      ask: z.string().min(1),
      canEdit: z.boolean(),
    })
    .optional(),
});
export type HandoffProposedParams = z.infer<typeof HandoffProposedParams>;

/** The person sends a proposed hand-off, in the folder they settled on. */
export const HandoffsConfirmParams = z.object({
  proposalId: z.uuid(),
  /** Left out only for an expert that works in its own folder. */
  folder: z.string().min(1).optional(),
  canEdit: z.boolean(),
  /** The brief as the person edited it, if they did. */
  brief: Brief.optional(),
  /**
   * The follow-up step as the person left it: its access and edited ask. Null when they removed
   * it; left out, it runs as proposed.
   */
  then: z
    .object({ canEdit: z.boolean(), ask: z.string().min(1).optional() })
    .nullable()
    .optional(),
});
export const HandoffsConfirmResult = z.object({ handoffId: z.uuid() });

export const HandoffsDismissParams = z.object({ proposalId: z.uuid() });
export const HandoffsDismissResult = z.object({ dismissed: z.boolean() });

/** Projects on this computer whose name or path matches, for "Change project". */
export const ProjectsSearchParams = z.object({ query: z.string().max(200) });
export const ProjectsSearchResult = z.object({ projects: z.array(ProjectCandidate) });
