import type { MessageRole, Pet } from '@tagalong/protocol';
import { DEFAULT_PET_COLOR } from './office/sprites/characters';

/**
 * A message as the panel shows it: the stored content blocks flattened to text, with who
 * said it and on which model (`speaker`), or what it records — a fired watch, or a note.
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** The pet that answered, for an assistant message. */
  petId?: string;
  /** "Scout · haiku": who said it, on what. */
  speaker?: string;
  kind?: 'note' | 'watch';
  /** For a fired watch: what the pet was watching for. */
  condition?: string;
}

export interface MessageListProps {
  messages: readonly ChatMessage[];
  /** The assistant text accumulated so far this turn; empty when nothing is in flight. */
  streamingText: string;
  /** Labels the streaming bubble with the pet and model answering. */
  streamingSpeaker?: string;
  /** The pets, for names and colours. */
  pets?: readonly Pet[];
}

const BUBBLE_BY_ROLE: Record<MessageRole, string> = {
  user: 'bg-sky-600 text-white',
  assistant: 'bg-slate-100 text-slate-900',
};

const COLUMN_BY_ROLE: Record<MessageRole, string> = {
  user: 'self-end items-end',
  assistant: 'self-start items-start',
};

function nameOf(pets: readonly Pet[], id: string | undefined): string {
  return pets.find((pet) => pet.id === id)?.name ?? id ?? 'A pet';
}

function colorOf(pets: readonly Pet[], id: string | undefined): string {
  return pets.find((pet) => pet.id === id)?.color ?? DEFAULT_PET_COLOR;
}

function Speaker({ text, color }: { text: string; color: string }) {
  return (
    <span data-testid="speaker" className="text-[11px] font-medium" style={{ color }}>
      {text}
    </span>
  );
}

export function MessageList({
  messages,
  streamingText,
  streamingSpeaker,
  pets = [],
}: MessageListProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
    >
      {messages.map((message) => {
        if (message.kind === 'watch') {
          return (
            <div
              key={message.id}
              data-testid="watch-fired"
              role="note"
              className="self-start max-w-[90%] rounded-lg border-2 px-3 py-2 text-sm"
              style={{ borderColor: colorOf(pets, message.petId) }}
            >
              <p
                className="text-[11px] font-medium"
                style={{ color: colorOf(pets, message.petId) }}
              >
                ⏰ {nameOf(pets, message.petId)}
                {message.condition === undefined ? '' : ` — watching for “${message.condition}”`}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            </div>
          );
        }
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
              <Speaker text={message.speaker} color={colorOf(pets, message.petId)} />
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
            <Speaker text={streamingSpeaker} color={DEFAULT_PET_COLOR} />
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
