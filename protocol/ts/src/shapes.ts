/**
 * Shared shapes of contract v1: Tool, Part, Body, the error table and the size limits.
 * Mirrors protocol/README.md, which wins on any disagreement. Limits are exported as
 * constants only; enforcing them is the brain's and bodies' job, not the schema's.
 */
import { z } from 'zod';

export const PROTOCOL = 1;

export const LIMITS = {
  partBytes: 5_000_000,
  messageBytes: 20_000_000,
  replayCount: 500,
  replayMs: 86_400_000,
} as const;

export const ErrorCode = {
  parse_error: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
  internal_error: -32603,
  version_mismatch: -32000,
  unknown_tool: -32001,
  not_found: -32002,
  denied: -32003,
  timeout: -32004,
  cancelled: -32005,
  body_offline: -32006,
  tool_failed: -32007,
  over_limit: -32008,
} as const;

const errorCodes: readonly number[] = Object.values(ErrorCode);

export const ErrorObject = z.object({
  code: z.number().refine((c) => errorCodes.includes(c), 'unknown error code'),
  message: z.string(),
  data: z.unknown().optional(),
});
export type ErrorObject = z.infer<typeof ErrorObject>;

// A body declares plain names; the brain adds the `<body>__` prefix, so `__` is reserved.
export const Tool = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9_-]{1,48}$/)
    .refine((n) => !n.includes('__'), 'tool names never contain __'),
  description: z.string(),
  input_schema: z.record(z.string(), z.unknown()),
  confirm: z.boolean().optional(),
});
export type Tool = z.infer<typeof Tool>;

// No `ref` source in v1: a part must carry `data`, so one with only `ref` fails here.
export const Part = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), mime: z.string(), data: z.string() }),
  z.object({
    type: z.literal('file'),
    mime: z.string(),
    name: z.string().optional(),
    data: z.string(),
  }),
]);
export type Part = z.infer<typeof Part>;

export const Body = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  kind: z.string(),
  name: z.string(),
});
export type Body = z.infer<typeof Body>;
