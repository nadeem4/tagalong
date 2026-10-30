/**
 * The chat panel's message list: user and assistant bubbles, notes, and
 * the answer still streaming. Contains MessageList and ChatMessage. Used by ChatPanel.
 */

import type { MessageRole } from '@tagalong/protocol';

/**
 * A message as the panel shows it: the stored content blocks flattened to text, with who
 * said it and on which model (`speaker`), or a note.
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** "Scout · haiku": who said it, on what. */
  speaker?: string;
  kind?: 'note';
}

export interface MessageListProps {
  messages: readonly ChatMessage[];
  /** The assistant text accumulated so far this turn; empty when nothing is in flight. */
  streamingText: string;
  /** Labels the streaming bubble with the pet and model answering. */
  streamingSpeaker?: string;
}

/** One colour for every speaker label. */
const SPEAKER_COLOR = '#64748b';

const BUBBLE_BY_ROLE: Record<MessageRole, string> = {
  user: 'bg-sky-600 text-white',
  assistant: 'bg-slate-100 text-slate-900',
};

const COLUMN_BY_ROLE: Record<MessageRole, string> = {
  user: 'self-end items-end',
  assistant: 'self-start items-start',
};

function Speaker({ text, color }: { text: string; color: string }) {
  return (
    <span data-testid="speaker" className="text-[11px] font-medium" style={{ color }}>
      {text}
    </span>
  );
}

export function MessageList({ messages, streamingText, streamingSpeaker }: MessageListProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
    >
      {messages.map((message) => {
        if (message.kind === 'note') {
          return (
            <div
              key={message.id}
              data-testid="note"
              role="separator"
              className="self-center text-[11px] uppercase tracking-wide text-slate-400"
            >
              {message.text}
            </div>
          );
        }

        return (
          <div
            key={message.id}
            className={`flex max-w-[85%] flex-col gap-0.5 ${COLUMN_BY_ROLE[message.role]}`}
          >
            {message.speaker !== undefined && (
              <Speaker text={message.speaker} color={SPEAKER_COLOR} />
            )}
            <div
              data-role={message.role}
              className={`max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 ${BUBBLE_BY_ROLE[message.role]}`}
            >
              {message.text}
            </div>
          </div>
        );
      })}
      {streamingText !== '' && (
        <div className={`flex max-w-[85%] flex-col gap-0.5 ${COLUMN_BY_ROLE.assistant}`}>
          {streamingSpeaker !== undefined && (
            <Speaker text={streamingSpeaker} color={SPEAKER_COLOR} />
          )}
          <div
            data-testid="streaming-message"
            data-role="assistant"
            className={`max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 ${BUBBLE_BY_ROLE.assistant}`}
          >
            {streamingText}
          </div>
        </div>
      )}
    </div>
  );
}
