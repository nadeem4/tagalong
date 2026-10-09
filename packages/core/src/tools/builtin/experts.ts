import type { Brief, Expert } from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import { defineTool, type Tool, type ToolContext, type ToolOutcome } from '../tool';

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
  /** Starts the hand-off; the answer comes back on its own, outside this turn. */
  start(params: { expertId: string; petId: string; brief: Brief }): { handoffId: string };
}

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
      `expert, or name one to choose.\nExperts:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        ask: { type: 'string', description: 'What the user wants, in their words.' },
        task_kind: { type: 'string', description: 'A short label, such as fix-code.' },
        expert_id: { type: 'string', description: 'One of the ids above.' },
        files: { type: 'array', items: { type: 'string' } },
        good_answer: { type: 'string', description: 'What a good answer looks like.' },
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

    try {
      deps.start({ expertId: expert.id, petId: ctx.pet.id, brief: briefFrom(parsed, ctx) });
    } catch (error) {
      return Promise.resolve({
        content: `The hand-off to ${expert.name} did not start: ${(error as Error).message}`,
        isError: true,
      });
    }
    deps.routes.remember(parsed.task_kind, expert.id, 'companion');
    return Promise.resolve({
      content:
        `${expert.name} has it. Tell the user in one line that ${expert.name} is on it; ` +
        'the answer will arrive on its own.',
    });
  });
}
