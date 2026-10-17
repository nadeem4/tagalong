/**
 * The expert tools: `hand_to_expert` writes a brief and hands it to an expert, and
 * `tell_expert` passes the person's words to one already working. Contains
 * `handToExpertTool`, `tellExpertTool` and `enabledExperts`.
 */
import type { Brief, Expert } from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import {
  defineTool,
  type RoutineTurnContext,
  type Tool,
  type ToolContext,
  type ToolOutcome,
} from '../tool';

/**
 * The companion's one way to get work done: it never does the work itself, it writes a
 * brief and hands it to an expert. `write`, because a hand-off outlives the turn.
 */
export const HAND_TO_EXPERT = 'hand_to_expert';

/**
 * Passes the person's words to an expert already working. `write`: the note waits in the
 * hand-off and is kept in its Activity row.
 */
export const TELL_EXPERT = 'tell_expert';

/** A hand-off that is running now, as `tell_expert` names it. */
export interface RunningHandoff {
  handoffId: string;
  expertId: string;
  expertName: string;
  ask: string;
}

export interface ExpertToolDeps {
  /** Read per turn: experts are added and switched off while the app runs. */
  experts: () => readonly Expert[];
  /**
   * Shows the brief to the person, who confirms it with a project folder; the answer then
   * comes back on its own, outside this turn.
   */
  propose(params: {
    expertId: string;
    petId: string;
    brief: Brief;
    /** One follow-up step, on the same card, that runs after the first one finishes well. */
    then?: { expertId: string; ask: string };
  }): { proposalId: string };
  /**
   * Starts the expert at once, read-only, with web search and no project: only for the expert
   * a saved routine's card allowed, on that routine's own turn.
   */
  startReadOnly?(params: { expertId: string; petId: string; brief: Brief }): { handoffId: string };
  /** The hand-offs running now, read per turn and per call. */
  running?(): RunningHandoff[];
  /** Queues a note for a running hand-off; it reaches the expert when its current step ends. */
  steer?(handoffId: string, text: string): { ok: true } | { ok: false; error: string };
}

/** Routine runs that already used their one pre-approved hand-off. */
const preApprovedUsed = new WeakSet<RoutineTurnContext>();

/** The experts a turn can hand to: only those switched on. */
export function enabledExperts(deps: ExpertToolDeps): Expert[] {
  return deps.experts().filter((expert) => expert.enabled);
}

/** One line per expert: id, name and what it is good at. */
function expertLine(e: Expert): string {
  return `${e.id} (${e.name})${e.goodAt ? `: ${e.goodAt}` : ''}`;
}

function definition(experts: readonly Expert[]): BrainTool {
  const list = experts.map((e) => `- ${expertLine(e)}`).join('\n');
  return {
    name: HAND_TO_EXPERT,
    description:
      'Hand the user’s request to an expert who does the work: changing code, writing, ' +
      'research. Write the ask in the user’s own words, name the files that matter, and say ' +
      'what a good answer looks like. What the user is looking at is added for you. The ' +
      'answer arrives later on its own.\n' +
      'expert_id picks the expert from the list below; it can be left out only when one ' +
      'expert is on.\n' +
      'then is one optional follow-up step for a different expert, such as a reviewer ' +
      'checking a change: it runs after the first one finishes, in the same project, with ' +
      'its answer. Use it only when the user asks for the work to be checked or passed on.\n' +
      `Experts:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        ask: { type: 'string', description: 'What the user wants, in their words.' },
        expert_id: { type: 'string', description: 'One of the ids above.' },
        files: { type: 'array', items: { type: 'string' } },
        good_answer: { type: 'string', description: 'What a good answer looks like.' },
        then: {
          type: 'object',
          description: 'Optional follow-up step for a different expert.',
          properties: {
            expert_id: { type: 'string', description: 'One of the ids above.' },
            ask: { type: 'string', description: 'What the second expert should do.' },
          },
          required: ['expert_id', 'ask'],
          additionalProperties: false,
        },
      },
      required: ['ask'],
      additionalProperties: false,
    },
  };
}

interface Input {
  ask: string;
  expert_id?: string;
  files?: string[];
  good_answer?: string;
  then?: { expert_id: string; ask: string };
}

function parse(input: unknown): Input | string {
  const value = (input ?? {}) as Record<string, unknown>;
  if (typeof value['ask'] !== 'string' || value['ask'].trim() === '') return 'ask is required.';
  const files = value['files'];
  if (files !== undefined && !(Array.isArray(files) && files.every((f) => typeof f === 'string'))) {
    return 'files must be a list of paths.';
  }
  const then = value['then'];
  if (then !== undefined) {
    const step = (typeof then === 'object' && then !== null ? then : {}) as Record<string, unknown>;
    const ask = step['ask'];
    if (typeof step['expert_id'] !== 'string' || typeof ask !== 'string' || ask.trim() === '') {
      return 'then needs an expert_id and an ask.';
    }
  }
  return value as unknown as Input;
}

function briefFrom(input: Input, ctx: ToolContext): Brief {
  const snapshot = ctx.snapshot;
  const context = {
    ...(snapshot?.app?.name ? { app: snapshot.app.name } : {}),
    ...(snapshot?.app?.windowTitle ? { windowTitle: snapshot.app.windowTitle } : {}),
    ...(snapshot?.selection ? { selection: snapshot.selection } : {}),
  };
  return {
    ask: input.ask,
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    ...(input.good_answer ? { goodAnswer: input.good_answer } : {}),
  };
}

/** `hand_to_expert`, describing the experts switched on when the turn starts. */
export function handToExpertTool(deps: ExpertToolDeps, experts: readonly Expert[]): Tool {
  return defineTool(definition(experts), 'write', (input, ctx): Promise<ToolOutcome> => {
    const parsed = parse(input);
    if (typeof parsed === 'string') return Promise.resolve({ content: parsed, isError: true });

    const available = enabledExperts(deps);
    const ids = available.map((e) => e.id).join(', ');
    // The model's pick; else the only expert on.
    const chosenId = parsed.expert_id ?? (available.length === 1 ? available[0]?.id : undefined);
    if (chosenId === undefined) {
      return Promise.resolve({
        content: `Name one with expert_id: ${available.map(expertLine).join('; ')}.`,
        isError: true,
      });
    }
    const expert = available.find((e) => e.id === chosenId);
    if (expert === undefined) {
      return Promise.resolve({
        content: `There is no expert '${chosenId}' switched on. Choose one of: ${ids}.`,
        isError: true,
      });
    }

    let then: { expert: Expert; ask: string } | undefined;
    if (parsed.then !== undefined) {
      const nextId = parsed.then.expert_id;
      const next = available.find((e) => e.id === nextId);
      if (next === undefined) {
        return Promise.resolve({
          content: `There is no expert '${nextId}' switched on for the next step. Choose one of: ${ids}.`,
          isError: true,
        });
      }
      if (next.id === expert.id) {
        return Promise.resolve({
          content: `The next step needs a different expert than ${expert.name}.`,
          isError: true,
        });
      }
      then = { expert: next, ask: parsed.then.ask };
    }

    const routine = ctx.routine;
    // A chain always shows the card: its second step is never pre-approved.
    if (
      then === undefined &&
      routine?.expertId === expert.id &&
      deps.startReadOnly !== undefined &&
      !preApprovedUsed.has(routine)
    ) {
      // One unattended hand-off per run, briefed only from what the person saved plus the
      // model's request: no screen context, no files.
      preApprovedUsed.add(routine);
      const ask =
        routine.instruction === undefined
          ? parsed.ask
          : `The saved routine asks: ${routine.instruction}\n\nThis run: ${parsed.ask}`;
      try {
        const { handoffId } = deps.startReadOnly({
          expertId: expert.id,
          petId: ctx.pet.id,
          brief: { ask },
        });
        routine.handedOff(handoffId);
      } catch (error) {
        return Promise.resolve({
          content: `${expert.name} could not start: ${(error as Error).message}`,
          isError: true,
        });
      }
      return Promise.resolve({
        content:
          `${expert.name} has it, read-only with no project, as the saved routine allows; ` +
          'its answer reaches them on its own.',
      });
    }

    const brief = briefFrom(parsed, ctx);
    try {
      deps.propose({
        expertId: expert.id,
        petId: ctx.pet.id,
        brief,
        ...(then === undefined ? {} : { then: { expertId: then.expert.id, ask: then.ask } }),
      });
    } catch (error) {
      return Promise.resolve({
        content: `The brief for ${expert.name} could not be shown: ${(error as Error).message}`,
        isError: true,
      });
    }
    return Promise.resolve({
      content:
        `The brief for ${expert.name}${then === undefined ? '' : `, then ${then.expert.name},`} ` +
        'is on a card for them to check, with the project to work in; it starts when they ' +
        'press Send, and the answer arrives on its own.',
    });
  });
}

function tellDefinition(running: readonly RunningHandoff[]): BrainTool {
  const list = running.map((r) => `- ${r.handoffId} (${r.expertName}): ${r.ask}`).join('\n');
  return {
    name: TELL_EXPERT,
    description:
      'Pass something the person says to an expert who is already working on their request, ' +
      'such as "use dayjs, not moment". Use it only when they want the expert told something: ' +
      'not to change a setting, and not for new work (that is hand_to_expert). Pass their own ' +
      'words, not yours. It reaches the expert when it finishes its current step, in the same ' +
      'session with the same access.\n' +
      'With one hand-off running, leave handoff_id out.\n' +
      `Running now:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What the person wants the expert told.' },
        handoff_id: { type: 'string', description: 'One of the ids above.' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  };
}

/** `tell_expert`, describing the hand-offs running when the turn starts. */
export function tellExpertTool(deps: ExpertToolDeps, running: readonly RunningHandoff[]): Tool {
  return defineTool(tellDefinition(running), 'write', (input): Promise<ToolOutcome> => {
    const fail = (content: string) => Promise.resolve({ content, isError: true });
    const value = (input ?? {}) as Record<string, unknown>;
    const message = value['message'];
    const wanted = value['handoff_id'];
    if (typeof message !== 'string' || message.trim() === '') return fail('message is required.');
    if (wanted !== undefined && typeof wanted !== 'string') return fail('handoff_id is an id.');
    // Read again: a hand-off may have finished since the turn started.
    const now = deps.running?.() ?? [];
    if (now.length === 0) {
      return fail('No expert is working on anything now, so there is no one to tell.');
    }
    const ids = now.map((r) => `${r.handoffId} (${r.expertName})`).join(', ');
    const target =
      wanted !== undefined
        ? now.find((r) => r.handoffId === wanted)
        : now.length === 1
          ? now[0]
          : undefined;
    if (target === undefined) {
      return fail(
        wanted === undefined
          ? `More than one expert is working. Name one with handoff_id: ${ids}.`
          : `No hand-off '${wanted}' is running. Choose one of: ${ids}.`,
      );
    }
    const steered = deps.steer?.(target.handoffId, message) ?? {
      ok: false as const,
      error: 'Notes cannot be passed on here.',
    };
    if (!steered.ok) return fail(steered.error);
    return Promise.resolve({
      content: `Queued for ${target.expertName}: it gets it when its current step ends.`,
    });
  });
}
