/**
 * Scout sets up routines for the person: `create_routine` writes one, `change_routine`
 * pauses, resumes, changes or deletes one by name. Both only show the routine card; nothing
 * is saved until the person presses Save. `write`, because a saved routine outlives the turn.
 * Contains `createRoutineTool` and `changeRoutineTool`.
 */
import {
  RoutineDraft,
  describeWhen,
  type Expert,
  type RoutineAction,
  type RoutineDraftInput,
  type RoutineView,
  type RoutineWhen,
} from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const CREATE_ROUTINE = 'create_routine';
export const CHANGE_ROUTINE = 'change_routine';

export interface RoutineToolDeps {
  /** Read per turn: the person adds and deletes routines in Home. */
  list(): readonly RoutineView[];
  experts(): readonly Expert[];
  /** Shows the routine card; the person saves it or not, outside this turn. */
  propose(params: {
    petId: string;
    action: RoutineAction;
    routine: RoutineDraftInput;
    routineId?: string | undefined;
  }): { proposalId: string };
}

const DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const WHEN_SCHEMA = {
  type: 'object',
  description:
    'daily, weekdays or weekly (with days) at a 24-hour time; or a trigger: launch (Tagalong ' +
    'opens), app (a window whose title or app name contains match appears), expert (an expert ' +
    'finishes), watch (a watch fires), meeting (minutes_before each meeting on the calendar ' +
    'linked in Home; the person pastes that link in the Meeting prep form, never in chat).',
  properties: {
    type: {
      type: 'string',
      enum: ['daily', 'weekdays', 'weekly', 'launch', 'app', 'expert', 'watch', 'meeting'],
    },
    time: { type: 'string', description: 'HH:MM, 24-hour, such as 08:00.' },
    days: { type: 'array', items: { type: 'string', enum: DAY_IDS } },
    match: { type: 'string', description: 'For app: part of the window title or app name.' },
    minutes_before: {
      type: 'integer',
      description: 'For meeting: 5 to 60 minutes before each meeting. Default 10.',
    },
  },
  required: ['type'],
};

const FIELDS = {
  name: { type: 'string', description: 'Short, such as Morning papers.' },
  when: WHEN_SCHEMA,
  what: {
    type: 'string',
    description: 'The instruction, in the person’s words, as you will run it each time.',
  },
  topics: { type: 'string', description: 'Topics to look for, when it is about papers or news.' },
  result: {
    type: 'array',
    description: 'Where the result goes. Default bubble. Activity always gets it.',
    items: { type: 'string', enum: ['bubble', 'voice', 'notification'] },
  },
  hand_to: {
    type: 'string',
    description:
      'An expert id this routine may hand to each time without asking: read-only, web ' +
      'search, no project. Only when the work needs the web or real research.',
  },
  uses: {
    type: 'array',
    description: 'What it reads, for the card: app names, the expert.',
    items: { type: 'string' },
  },
};

function expertList(experts: readonly Expert[]): string {
  const on = experts.filter((e) => e.enabled);
  return on.length === 0
    ? 'No experts are switched on.'
    : `Experts: ${on.map((e) => `${e.id} (${e.name})`).join(', ')}.`;
}

function createDefinition(experts: readonly Expert[]): BrainTool {
  return {
    name: CREATE_ROUTINE,
    description:
      'Set up a routine the person asked for: something you do for them on a schedule or when ' +
      'something happens, such as "every weekday at 8, give me new papers on AI agents". It ' +
      'shows them a card; nothing is saved until they press Save, so never say it is set up ' +
      'until then. Each run is one of your turns with your normal tools: read tools of their ' +
      'connected apps run, and anything that changes something still asks them each time. ' +
      'For papers or news from the web, use an arXiv or paper app if one is connected; ' +
      `otherwise set hand_to to an expert that can search the web. ${expertList(experts)}`,
    inputSchema: {
      type: 'object',
      properties: FIELDS,
      required: ['name', 'when', 'what'],
      additionalProperties: false,
    },
  };
}

function changeDefinition(saved: readonly RoutineView[], experts: readonly Expert[]): BrainTool {
  const list = saved
    .map((r) => `- ${r.name}: ${describeWhen(r.when)}${r.enabled ? '' : ' (paused)'}`)
    .join('\n');
  return {
    name: CHANGE_ROUTINE,
    description:
      'Pause, resume, change or delete one of the person’s routines, by its name. It shows ' +
      'them a card and changes nothing until they press Save. For update, give only the fields ' +
      `that change. ${expertList(experts)}\nRoutines:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The routine’s name, as listed.' },
        action: { type: 'string', enum: ['update', 'pause', 'resume', 'delete'] },
        ...Object.fromEntries(Object.entries(FIELDS).filter(([key]) => key !== 'name')),
        new_name: { type: 'string', description: 'For update: a new name.' },
      },
      required: ['name', 'action'],
      additionalProperties: false,
    },
  };
}

type Input = Record<string, unknown>;

function whenFrom(value: unknown): RoutineWhen | string {
  const when = (value ?? {}) as Record<string, unknown>;
  const time = typeof when['time'] === 'string' ? when['time'] : '';
  switch (when['type']) {
    case 'daily':
      return { type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time };
    case 'weekdays':
      return { type: 'schedule', days: [1, 2, 3, 4, 5], time };
    case 'weekly': {
      const days = Array.isArray(when['days']) ? when['days'] : [];
      const numbers = days.map((day) => DAY_IDS.indexOf(String(day).toLowerCase().slice(0, 3)));
      if (numbers.length === 0 || numbers.includes(-1)) {
        return 'weekly needs days, such as ["mon", "thu"].';
      }
      return { type: 'schedule', days: [...new Set(numbers)].sort((a, b) => a - b), time };
    }
    case 'launch':
    case 'expert':
    case 'watch':
      return { type: when['type'] };
    case 'app':
      return { type: 'app', match: typeof when['match'] === 'string' ? when['match'] : '' };
    case 'meeting': {
      const minutes = when['minutes_before'] ?? 10;
      return { type: 'meeting', minutesBefore: typeof minutes === 'number' ? minutes : NaN };
    }
    default:
      return 'when.type must be daily, weekdays, weekly, launch, app, expert, watch or meeting.';
  }
}

function deliverFrom(value: unknown) {
  const list = Array.isArray(value) ? value.map(String) : ['bubble'];
  return {
    bubble: list.includes('bubble'),
    voice: list.includes('voice'),
    notification: list.includes('notification'),
  };
}

/** The draft the card shows, laid over `base` for a change; or why it cannot be one. */
function draftFrom(
  input: Input,
  experts: readonly Expert[],
  base?: RoutineDraftInput,
): RoutineDraftInput | string {
  const fields: Record<string, unknown> = { ...base };
  const name = input['new_name'] ?? (base === undefined ? input['name'] : undefined);
  if (name !== undefined) fields['name'] = name;
  if (input['what'] !== undefined) fields['what'] = input['what'];
  if (input['topics'] !== undefined) fields['topics'] = input['topics'];
  if (input['uses'] !== undefined) fields['uses'] = input['uses'];
  if (input['result'] !== undefined || base === undefined) {
    fields['deliver'] = deliverFrom(input['result']);
  }
  if (input['when'] !== undefined) {
    const when = whenFrom(input['when']);
    if (typeof when === 'string') return when;
    fields['when'] = when;
  }
  if (input['hand_to'] !== undefined) {
    const id = String(input['hand_to']);
    if (!experts.some((e) => e.id === id && e.enabled)) {
      return `There is no expert '${id}' switched on. ${expertList(experts)}`;
    }
    fields['handTo'] = id;
  }
  const parsed = RoutineDraft.safeParse(fields);
  if (!parsed.success) {
    return parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'routine'}: ${issue.message}`)
      .join('; ');
  }
  return fields as RoutineDraftInput;
}

const SHOWN =
  'The routine card is in front of the person. Tell them in one line to check it and press ' +
  'Save; nothing runs until they do. Once saved, the card offers to run it now to test.';

export function createRoutineTool(deps: RoutineToolDeps): Tool {
  return defineTool(createDefinition(deps.experts()), 'write', (input, ctx) => {
    const draft = draftFrom((input ?? {}) as Input, deps.experts());
    if (typeof draft === 'string') return Promise.resolve({ content: draft, isError: true });
    deps.propose({ petId: ctx.pet.id, action: 'create', routine: draft });
    return Promise.resolve({ content: SHOWN });
  });
}

/** Saved routines as drafts: what the card and an update start from. */
function asDraft(routine: RoutineView): RoutineDraftInput {
  return {
    name: routine.name,
    enabled: routine.enabled,
    when: routine.when,
    what: routine.what,
    topics: routine.topics,
    deliver: routine.deliver,
    uses: routine.uses,
    ...(routine.handTo !== undefined ? { handTo: routine.handTo } : {}),
  };
}

export function changeRoutineTool(deps: RoutineToolDeps, saved: readonly RoutineView[]): Tool {
  return defineTool(
    changeDefinition(saved, deps.experts()),
    'write',
    (input, ctx): Promise<ToolOutcome> => {
      const value = (input ?? {}) as Input;
      const name = typeof value['name'] === 'string' ? value['name'].trim().toLowerCase() : '';
      const routine = deps.list().find((r) => r.name.toLowerCase() === name);
      if (routine === undefined) {
        const names = deps
          .list()
          .map((r) => r.name)
          .join(', ');
        return Promise.resolve({
          content: `There is no routine called '${String(value['name'])}'. Routines: ${names}.`,
          isError: true,
        });
      }
      const action = value['action'];
      if (action !== 'update' && action !== 'pause' && action !== 'resume' && action !== 'delete') {
        return Promise.resolve({
          content: 'action must be update, pause, resume or delete.',
          isError: true,
        });
      }
      const base = asDraft(routine);
      const draft = action === 'update' ? draftFrom(value, deps.experts(), base) : base;
      if (typeof draft === 'string') return Promise.resolve({ content: draft, isError: true });
      deps.propose({ petId: ctx.pet.id, action, routine: draft, routineId: routine.id });
      return Promise.resolve({ content: SHOWN });
    },
  );
}
