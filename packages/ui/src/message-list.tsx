import type { MessageRole } from '@tagalong/protocol';

/** A message as the panel shows it: the stored content blocks flattened to text. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
}

export interface MessageListProps {
  messages: readonly ChatMessage[];
  /** The assistant text accumulated so far this turn; empty when nothing is in flight. */
  streamingText: string;
}

const BUBBLE_BY_ROLE: Record<MessageRole, string> = {
  user: 'self-end bg-sky-600 text-white',
  assistant: 'self-start bg-slate-100 text-slate-900',
};

export function MessageList({ messages, streamingText }: MessageListProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
    >
      {messages.map((message) => (
        <div
          key={message.id}
          data-role={message.role}
          className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 ${BUBBLE_BY_ROLE[message.role]}`}
        >
          {message.text}
        </div>
      ))}
      {streamingText !== '' && (
        <div
          data-testid="streaming-message"
          data-role="assistant"
          className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 ${BUBBLE_BY_ROLE.assistant}`}
        >
          {streamingText}
        </div>
      )}
    </div>
  );
}
