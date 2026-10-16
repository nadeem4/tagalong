/**
 * Routines: when + what + where the result goes. "Every weekday at 8, give me new papers on
 * AI agents." The engine runs each one as a Scout turn on a schedule or a trigger; the person
 * never writes cron, only picks days and a time, or one of five triggers.
 * Contains Routine and its parts, describeWhen/describeDeliver, and the `routines.*`,
 * `routine.*` and `calendar.*` messages.
 */
import { z } from 'zod';

/** Days of the week as `Date#getDay` numbers: 0 is Sunday. */
export const Weekday = z.number().int().min(0).max(6);

export const RoutineWhen = z.discriminatedUnion('type', [
  /** Daily, weekdays or chosen days, at a local time. */
  z.object({
    type: z.literal('schedule'),
    days: z.array(Weekday).min(1).max(7),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time is HH:MM, 24-hour'),
  }),
  /** Tagalong opens. */
  z.object({ type: z.literal('launch') }),
  /** A window whose title or app name contains `match` appears. */
  z.object({ type: z.literal('app'), match: z.string().trim().min(1).max(100) }),
  /** An expert finishes a hand-off. */
  z.object({ type: z.literal('expert') }),
  /** A watch fires. */
  z.object({ type: z.literal('watch') }),
  /**
   * Minutes before each meeting on the calendar linked in Home (an .ics link kept in the
   * keychain, never in a routine or in settings). Home offers 10 and 30.
   */
  z.object({ type: z.literal('meeting'), minutesBefore: z.number().int().min(5).max(60) }),
]);
export type RoutineWhen = z.infer<typeof RoutineWhen>;

/** Where the result goes. Activity always gets it, so it is not a choice. */
export const RoutineDeliver = z.object({
  bubble: z.boolean().default(true),
  voice: z.boolean().default(false),
  notification: z.boolean().default(false),
});
export type RoutineDeliver = z.infer<typeof RoutineDeliver>;

const routineFields = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  when: RoutineWhen,
  /** The instruction, in plain words, run as a Scout turn. */
  what: z.string().trim().min(1).max(2_000),
  /** Morning papers' topics; any routine may carry some. */
  topics: z.string().max(500).default(''),
  deliver: RoutineDeliver.default({ bubble: true, voice: false, notification: false }),
  /**
   * The expert this routine may hand to without a card: read-only, no project, web search
   * allowed. Set only when the card that saved it said so. Absent: a hand-off shows the
   * normal card.
   */
  handTo: z.string().min(1).optional(),
  /** What it reads, as the card shows it: "Google Calendar", "arXiv". Display only. */
  uses: z.array(z.string().min(1).max(60)).max(10).default([]),
};

export const Routine = z.object({
  id: z.uuid(),
  ...routineFields,
  createdAt: z.iso.datetime(),
});
export type Routine = z.infer<typeof Routine>;

/** A routine not saved yet: what the card shows and the form edits. */
export const RoutineDraft = z.object(routineFields);
export type RoutineDraft = z.infer<typeof RoutineDraft>;
export type RoutineDraftInput = z.input<typeof RoutineDraft>;

/** A saved routine with how it last ran and when it runs next, for Home. */
export const RoutineView = Routine.extend({
  lastRunAt: z.iso.datetime().optional(),
  lastState: z.enum(['running', 'done', 'error']).optional(),
  /** The Activity entry of the last run. */
  lastActivityId: z.string().min(1).optional(),
  /** Schedules and meetings. */
  nextRunAt: z.iso.datetime().optional(),
  /** What stops it, in plain words: a calendar that cannot be read. Meeting routines only. */
  problem: z.string().min(1).optional(),
});
export type RoutineView = z.infer<typeof RoutineView>;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Weekdays at 08:00", "When Outlook appears": how the card and Home say when. */
export function describeWhen(when: RoutineWhen): string {
  switch (when.type) {
    case 'schedule': {
      const days = [...new Set(when.days)].sort((a, b) => a - b);
      const key = days.join(',');
      const label =
        key === '0,1,2,3,4,5,6'
          ? 'Every day'
          : key === '1,2,3,4,5'
            ? 'Weekdays'
            : key === '0,6'
              ? 'Weekends'
              : days.map((day) => DAY_NAMES[day]).join(', ');
      return `${label} at ${when.time}`;
    }
    case 'launch':
      return 'When Tagalong opens';
    case 'app':
      return `When ${when.match} appears`;
    case 'expert':
      return 'When an expert finishes';
    case 'watch':
      return 'When a watch fires';
    case 'meeting':
      return `${when.minutesBefore} min before each meeting`;
  }
}

/** "Bubble, voice, Activity". */
export function describeDeliver(deliver: RoutineDeliver): string {
  const parts = [
    deliver.bubble ? 'Bubble' : null,
    deliver.voice ? 'voice' : null,
    deliver.notification ? 'Windows notification' : null,
  ].filter((part): part is string => part !== null);
  const all = [...parts, 'Activity'];
  const first = all[0] ?? 'Activity';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...all.slice(1)].join(', ');
}

export const RoutinesListParams = z.object({});
export const RoutinesListResult = z.object({ routines: z.array(RoutineView) });

/** Home's form: a new routine without an id, an edited one with it. Saving is consent. */
export const RoutinesSaveParams = z.object({
  routine: RoutineDraft.extend({ id: z.uuid().optional() }),
});
export const RoutinesSaveResult = z.object({ routine: RoutineView });

export const RoutinesDeleteParams = z.object({ id: z.uuid() });
export const RoutinesDeleteResult = z.object({ deleted: z.boolean() });

export const RoutinesSetEnabledParams = z.object({ id: z.uuid(), enabled: z.boolean() });
export const RoutinesSetEnabledResult = z.object({ routine: RoutineView });

/** Runs it once now, whatever its schedule says. The result arrives as `routine.result`. */
export const RoutinesRunNowParams = z.object({ id: z.uuid() });
export const RoutinesRunNowResult = z.object({ started: z.boolean() });

/** What Scout asked to do with a routine, shown on the routine card. */
export const RoutineAction = z.enum(['create', 'update', 'pause', 'resume', 'delete']);
export type RoutineAction = z.infer<typeof RoutineAction>;

/**
 * Scout wrote or changed a routine. Nothing is saved until the person presses Save
 * (`routines.confirm`); Cancel is `routines.dismiss`.
 */
export const RoutineProposedParams = z.object({
  proposalId: z.uuid(),
  petId: z.string().min(1),
  action: RoutineAction,
  /** The routine as it would be saved; for a change, the routine it changes. */
  routine: RoutineDraft,
  /** The saved routine a change applies to. */
  routineId: z.uuid().optional(),
  /** The expert `handTo` names, as the card says it: "May hand to: Researcher". */
  handToName: z.string().min(1).optional(),
});
export type RoutineProposedParams = z.infer<typeof RoutineProposedParams>;

export const RoutinesConfirmParams = z.object({
  proposalId: z.uuid(),
  /** The routine as the person edited it, if they did. */
  routine: RoutineDraft.optional(),
});
export const RoutinesConfirmResult = z.object({
  routine: RoutineView.optional(),
  deleted: z.boolean().optional(),
});

export const RoutinesDismissParams = z.object({ proposalId: z.uuid() });
export const RoutinesDismissResult = z.object({ dismissed: z.boolean() });

/**
 * A routine ran. `line` is the quiet line for the bubble; `text` the full answer, in Scout's
 * conversation `conversationId`, so a follow-up continues it. `late` when the PC was asleep
 * or off at the time and it ran at the next wake or launch.
 */
export const RoutineResultParams = z.object({
  routineId: z.uuid(),
  name: z.string().min(1),
  petId: z.string().min(1),
  conversationId: z.uuid().optional(),
  state: z.enum(['done', 'error']),
  line: z.string().min(1),
  text: z.string(),
  late: z.boolean(),
  deliver: RoutineDeliver,
  activityId: z.string().min(1).optional(),
});
export type RoutineResultParams = z.infer<typeof RoutineResultParams>;

/**
 * Meeting prep's calendar: a secret .ics link the engine keeps in the keychain under
 * `calendar.ics`. It is never in settings, never returned, and only https is taken. Null
 * forgets it. Saving fetches it once, so the answer says whether it reads.
 */
export const CalendarSetLinkParams = z.object({
  link: z
    .url({ protocol: /^https$/, error: 'the calendar link must start with https://' })
    .max(2_000)
    .nullable(),
});

/** Whether a link is kept and how many meetings it holds in the next 36 hours; never the link. */
export const CalendarCheckResult = z.object({
  linked: z.boolean(),
  meetings: z.number().int().min(0),
  /** Why it could not be read, in plain words. */
  error: z.string().min(1).optional(),
});
export type CalendarCheckResult = z.infer<typeof CalendarCheckResult>;
export const CalendarSetLinkResult = CalendarCheckResult;
export const CalendarCheckParams = z.object({});

/** Something about the routines changed: Home lists them again. */
export const RoutinesChangedParams = z.looseObject({});
