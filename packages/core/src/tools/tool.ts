import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../providers';

/**
 * Whether running a tool changes stored state.
 *
 * The rule: a tool is `write` when it leaves something behind after the turn — a memory
 * filed, a watch started. Everything that only looks, reads or asks is `read`, even when
 * it costs a model call.
 * Phase 8 grants will lean on this, so decide it by the state, not by how risky it feels.
 */
export type ToolKind = 'read' | 'write';

/** Exactly what `BrainEvents.onToolUse` must resolve with. */
export interface ToolOutcome {
  content: string | BrainContentBlock[];
  isError?: boolean;
}

/** A turn a routine started: what the saved routine allows, and where a hand-off reports. */
export interface RoutineTurnContext {
  routineId: string;
  /** The expert the routine's card allowed: read-only, no project, no card. */
  expertId?: string | undefined;
  /** The routine's saved instruction: the pre-approved brief is built from it. */
  instruction?: string | undefined;
  /** The hand-off the turn started with that expert, so the routine waits for its answer. */
  handedOff: (handoffId: string) => void;
}

/** What one turn hands every tool it runs. */
export interface ToolContext {
  /** The pet whose turn it is: memories are filed under it. */
  pet: Pet;
  turnId: string;
  signal: AbortSignal;
  /** The turn's snapshot, already without pixels when this pet's brain cannot see. */
  snapshot?: ContextSnapshot | undefined;
  /**
   * Whether this pet's brain can decode an image. Pets pick their own provider and model,
   * so only the turn knows. Absent means no sight: base64 sent to a model that cannot read
   * it burns tokens and teaches it nothing.
   */
  vision?: boolean | undefined;
  /** Set on a turn a routine started. */
  routine?: RoutineTurnContext | undefined;
}

/** One built-in tool, in the one shape every tool has. */
export interface Tool {
  /** The tool's name, as the model sees it: `definition.name`. */
  readonly id: string;
  readonly definition: BrainTool;
  readonly kind: ToolKind;
  /**
   * A family a role can list as one entry instead of tool by tool: `connections` for the
   * tools of the person's connected apps, whose names are not known until they connect.
   */
  readonly group?: string;
  run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Builds a `Tool` whose id cannot drift from the name in its definition. */
export function defineTool(definition: BrainTool, kind: ToolKind, run: Tool['run']): Tool {
  return { id: definition.name, definition, kind, run };
}
