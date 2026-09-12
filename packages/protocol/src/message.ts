import { z } from 'zod';
import { ContextSnapshot } from './context';

export const MessageRole = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRole>;

/**
 * One block inside a message. Mirrors the provider-neutral content shape so the
 * conversation store and the BrainProvider speak the same language.
 */
export const MessageContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    mime: z.enum(['image/png', 'image/jpeg']),
    base64: z.string().min(1),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string().min(1),
    content: z.string(),
    isError: z.boolean().optional(),
  }),
]);
export type MessageContent = z.infer<typeof MessageContent>;

/** A stored turn of conversation, with the context that produced it. */
export const Message = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  role: MessageRole,
  content: z.array(MessageContent).min(1),
  snapshot: ContextSnapshot.optional(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  id: z.uuid(),
  petId: z.string().min(1),
  title: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof Conversation>;
