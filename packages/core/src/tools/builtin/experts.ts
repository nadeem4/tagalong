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
 * brief and hands it to an expert. `write`, because a hand-off and a remembered route
 * outlive the turn.
 */
export const HAND_TO_EXPERT = 'hand_to_expert';

export interface ExpertToolDeps {
  /** Read per turn: experts are added and switched off while the app runs. */
  experts: () => readonly Expert[];
  routes: {
    get(taskKind: string): { expertId: string; by: 'companion' | 'user' } | null;
    remember(taskKind: string, expertId: string, by: 'companion'): void;
  };
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
}

/** Routine runs that already used their one pre-approved hand-off. */
const preApprovedUsed = new WeakSet<RoutineTurnContext>();

/** The experts a turn can hand to: only those switched on. */
export function enabledExperts(deps: ExpertToolDeps): Expert[] {
  return deps.experts().filter((expert) => expert.enabled);
}

function definition(experts: readonly Expert[]): BrainTool {
  const list = experts
    .map((e) => `- ${e.id} (${e.name})${e.goodAt ? `: ${e.goodAt}` : ''}`)
    .join('\n');
  return {
    name: HAND_TO_EXPERT,
    description:
      'Hand the user’s request to an expert who does the work, then tell the user who has it. ' +
      'Use this for anything that needs real work: changing code, writing, research. Write the ' +
      'ask in the user’s own words, name the files that matter, and say what a good answer ' +
      'looks like. What the user is looking at is added for you. The answer arrives later on ' +
      'its own, so do not wait for it or guess it.\n' +
      'task_kind is a short label for the kind of task, such as fix-code or summarise; the ' +
      'expert who took that kind before takes it again. Leave expert_id out to use that ' +
      'expert, or name one to choose.\n' +
      'then is one optional follow-up step for a different expert, such as a reviewer ' +
      'checking a change: it runs after the first one finishes, in the same project, with ' +
      'its answer. Use it only when the user asks for the work to be checked or passed on.\n' +
      `Experts:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        ask: { type: 'string', description: 'What the user wants, in their words.' },
        task_kind: { type: 'string', description: 'A short label, such as fix-code.' },
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
      required: ['ask', 'task_kind'],
      additionalProperties: false,
    },
  };
}

interface Input {
  ask: string;
  task_kind: string;
  expert_id?: string;
  files?: string[];
  good_answer?: string;
  then?: { expert_id: string; ask: string };
}

function parse(input: unknown): Input | string {
  const value = (input ?? {}) as Record<string, unknown>;
  if (typeof value['ask'] !== 'string' || value['ask'].trim() === '') return 'ask is required.';
  if (typeof value['task_kind'] !== 'string' || value['task_kind'].trim() === '') {
    return 'task_kind is required.';
  }
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
    const route = deps.routes.get(parsed.task_kind);
    // The user's choice wins; then the model's pick; then the remembered one; then the only one.
    const chosenId =
      (route?.by === 'user' ? route.expertId : undefined) ??
      parsed.expert_id ??
      route?.expertId ??
      (available.length === 1 ? available[0]?.id : undefined);
    if (chosenId === undefined) {
      return Promise.resolve({
        content: `No expert has taken '${parsed.task_kind}' before. Name one with expert_id: ${ids}.`,
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
          `${expert.name} has it, read-only with no project, as the saved routine allows. ` +
          'Say so in one line; its answer reaches the person on its own.',
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
    deps.routes.remember(parsed.task_kind, expert.id, 'companion');
    return Promise.resolve({
      content:
        `The brief for ${expert.name}${then === undefined ? '' : `, then ${then.expert.name},`} ` +
        'is in front of the user to check, with the project to ' +
        'work in. Tell them in one line to check it and press Send; the answer arrives on its own.',
    });
  });
}
