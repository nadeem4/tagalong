/**
 * Params and result schema for each of the fifteen messages, plus the two method maps
 * (body to brain, brain to body). The maps let a receiver, and the examples test, look
 * a schema up by method name. `protocol` is any integer so a newer body gets
 * version_mismatch from the handler instead of a schema failure.
 */
import { z, type ZodType } from 'zod';
import { Body, Part, Tool } from './shapes.js';

const Id = z.string();
// last_seq and the hello seq may be 0 (nothing seen yet); every notification seq starts at 1.
const HandshakeSeq = z.int().min(0);
const Seq = z.int().min(1);
const Input = z.record(z.string(), z.unknown());

export const EmptyResult = z.object({});
export type EmptyResult = z.infer<typeof EmptyResult>;

// Body -> brain

export const HelloParams = z.object({
  protocol: z.int(),
  body: Body,
  tools: z.array(Tool),
  last_seq: HandshakeSeq.optional(),
});
export type HelloParams = z.infer<typeof HelloParams>;

export const HelloResult = z.object({
  protocol: z.int(),
  session: Id,
  tools: z.array(Tool),
  seq: HandshakeSeq,
  resync: z.boolean(),
});
export type HelloResult = z.infer<typeof HelloResult>;

export const ToolsParams = z.object({ tools: z.array(Tool) });
export type ToolsParams = z.infer<typeof ToolsParams>;

export const SayParams = z
  .object({
    text: z.string().optional(),
    parts: z.array(Part).optional(),
    context: z.unknown().optional(),
    spoken: z.boolean().optional(),
  })
  .refine((m) => m.text !== undefined || m.parts !== undefined, 'say needs text or parts');
export type SayParams = z.infer<typeof SayParams>;

const CONFIRM_OPTIONS = [
  ['allow', 'deny'],
  ['allow', 'always', 'deny'],
];

export const SayResult = z.object({ turn: Id, joined: z.boolean() });
export type SayResult = z.infer<typeof SayResult>;

export const EventParams = z.object({ name: z.string(), data: z.unknown().optional() });
export type EventParams = z.infer<typeof EventParams>;

// Data of the `back` and `focus` events.
export const BackEventData = z.object({ idle_seconds: z.number().int().nonnegative() });
export type BackEventData = z.infer<typeof BackEventData>;

export const FocusEventData = z.object({ app: z.string(), title: z.string() });
export type FocusEventData = z.infer<typeof FocusEventData>;

// Data of the browser body's `tab` and `download` events.
export const TabEventData = z.object({ title: z.string(), url: z.string() });
export type TabEventData = z.infer<typeof TabEventData>;

export const DownloadEventData = z.object({
  name: z.string(),
  state: z.enum(['complete', 'interrupted']),
});
export type DownloadEventData = z.infer<typeof DownloadEventData>;

export const CallParams = z.object({ tool: z.string(), input: Input });
export type CallParams = z.infer<typeof CallParams>;

export const CallResult = z.object({ output: z.array(Part) });
export type CallResult = z.infer<typeof CallResult>;

export const AnswerParams = z.object({ ask: Id, option: z.string(), text: z.string().optional() });
export type AnswerParams = z.infer<typeof AnswerParams>;

export const CancelTurnParams = z.object({ turn: Id });
export type CancelTurnParams = z.infer<typeof CancelTurnParams>;

export const ProgressParams = z.object({ call: Id, text: z.string() });
export type ProgressParams = z.infer<typeof ProgressParams>;

// Brain -> body

export const UseParams = z.object({ call: Id, tool: z.string(), input: Input });
export type UseParams = z.infer<typeof UseParams>;

export const UseResult = z.object({ output: z.array(Part) });
export type UseResult = z.infer<typeof UseResult>;

export const CancelCallParams = z.object({ call: Id });
export type CancelCallParams = z.infer<typeof CancelCallParams>;

// A reply is either a delta chunk or the single `done`; the never fields reject both at once.
export const ReplyParams = z.union([
  z.object({
    seq: Seq,
    turn: Id,
    body: z.string().nullable(),
    delta: z.string(),
    done: z.never().optional(),
  }),
  z.object({
    seq: Seq,
    turn: Id,
    body: z.string().nullable(),
    done: z.literal(true),
    delta: z.never().optional(),
  }),
]);
export type ReplyParams = z.infer<typeof ReplyParams>;

// `body` is null when no body is online to show a turn the brain started itself.
export const TurnParams = z.object({
  seq: Seq,
  turn: Id,
  body: z.string().nullable(),
  state: z.enum(['started', 'ended']),
  reason: z.enum(['done', 'cancelled', 'error', 'over_budget', 'step_cap']).optional(),
  started_by: z.enum(['user', 'brain']).optional(),
});
export type TurnParams = z.infer<typeof TurnParams>;

export const ToolParams = z.object({
  seq: Seq,
  turn: Id,
  call: Id,
  name: z.string(),
  state: z.enum(['started', 'ended']),
  ok: z.boolean().optional(),
  summary: z.string().optional(),
});
export type ToolParams = z.infer<typeof ToolParams>;

const AskOpen = z
  .object({
    seq: Seq,
    id: Id,
    state: z.literal('open'),
    turn: Id.optional(),
    text: z.string(),
    options: z.array(z.string()),
    confirm: z.boolean().optional(),
    tool: z.string().optional(),
    input: Input.optional(),
  })
  .refine(
    (a) =>
      !a.confirm ||
      (a.tool !== undefined &&
        a.input !== undefined &&
        CONFIRM_OPTIONS.some(
          (o) => o.length === a.options.length && o.every((v, i) => v === a.options[i]),
        )),
    'a confirm ask needs tool, input and options ["allow","deny"] or ["allow","always","deny"]',
  );

const AskClosed = z.object({
  seq: Seq,
  id: Id,
  state: z.literal('closed'),
  reason: z.enum(['answered', 'timeout', 'cancelled']),
  option: z.string().optional(),
  by: z.string().optional(),
});

export const AskParams = z.union([AskOpen, AskClosed]);
export type AskParams = z.infer<typeof AskParams>;

export const ChangedParams = z.object({ seq: Seq, what: z.string() });
export type ChangedParams = z.infer<typeof ChangedParams>;

export const ApprovedParams = z.object({
  seq: Seq,
  tool: z.string(),
  text: z.string(),
  preference: z.string(),
});
export type ApprovedParams = z.infer<typeof ApprovedParams>;

export interface MethodSchemas {
  params: ZodType;
  result?: ZodType;
}

export const bodyToBrain = {
  hello: { params: HelloParams, result: HelloResult },
  tools: { params: ToolsParams, result: EmptyResult },
  say: { params: SayParams, result: SayResult },
  event: { params: EventParams },
  call: { params: CallParams, result: CallResult },
  answer: { params: AnswerParams, result: EmptyResult },
  cancel: { params: CancelTurnParams },
  progress: { params: ProgressParams },
} satisfies Record<string, MethodSchemas>;

export const brainToBody = {
  use: { params: UseParams, result: UseResult },
  cancel: { params: CancelCallParams },
  reply: { params: ReplyParams },
  turn: { params: TurnParams },
  tool: { params: ToolParams },
  ask: { params: AskParams },
  changed: { params: ChangedParams },
  approved: { params: ApprovedParams },
} satisfies Record<string, MethodSchemas>;

export type BodyToBrainMethod = keyof typeof bodyToBrain;
export type BrainToBodyMethod = keyof typeof brainToBody;
