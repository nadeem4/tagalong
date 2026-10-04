import type { MessageRole, Pet } from '@tagalong/protocol';
import { DEFAULT_PET_COLOR } from './crew-strip';

/**
 * A message as the panel shows it: the stored content blocks flattened to text.
 *
 * Crew messages carry more: which pet said it and on which model (`speaker`), or what kind
 * of crew event it records — a handoff bubble, a consult card, a roundtable round marker.
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** The pet that answered, for an assistant message in a crew. */
  petId?: string;
  /** "Ink · anthropic/claude-sonnet-5": who said it, on what. */
  speaker?: string;
  kind?: 'handoff' | 'consult' | 'round';
  /** For a handoff or consult: who addressed whom. */
  fromPetId?: string;
  toPetId?: string;
}

export interface MessageListProps {
  messages: readonly ChatMessage[];
  /** The assistant text accumulated so far this turn; empty when nothing is in flight. */
  streamingText: string;
  /** Labels the streaming bubble with the pet and model answering. */
  streamingSpeaker?: string;
  /** The crew, for names, avatars and colours. Empty for a single-pet host. */
  pets?: readonly Pet[];
  /** Offered on each answer when set: hands the thread to another pet. */
  onHandoff?: (fromPetId: string, toPetId: string) => void;
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
  onHandoff,
}: MessageListProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
    >
      {messages.map((message) => {
        if (message.kind === 'handoff') {
          return (
            <div
              key={message.id}
              data-testid="handoff"
              role="note"
              className="self-center w-[90%] rounded-lg border border-dashed px-3 py-2 text-xs text-slate-600"
              style={{ borderColor: colorOf(pets, message.toPetId) }}
            >
              <p className="font-medium">
                {nameOf(pets, message.fromPetId)} handed this to {nameOf(pets, message.toPetId)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            </div>
          );
        }
        if (message.kind === 'consult') {
          return (
            <div
              key={message.id}
              data-testid="consult"
              role="note"
              className="self-start rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
            >
              {nameOf(pets, message.fromPetId)} consulted {nameOf(pets, message.toPetId)}:{' '}
              {message.text}
            </div>
          );
        }
        if (message.kind === 'round') {
          return (
            <div
              key={message.id}
              data-testid="round"
              role="separator"
              className="self-center text-[11px] uppercase tracking-wide text-slate-400"
            >
              {message.text}
            </div>
          );
        }

        const others =
          onHandoff !== undefined && message.role === 'assistant' && message.petId !== undefined
            ? pets.filter((pet) => pet.id !== message.petId)
            : [];
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
            {others.length > 0 && (
              <select
                aria-label="Hand off"
                value=""
                onChange={(event) => {
                  if (event.target.value !== '' && message.petId !== undefined) {
                    onHandoff?.(message.petId, event.target.value);
                  }
                }}
                className="rounded border-none bg-transparent text-[11px] text-slate-500"
              >
                <option value="">Hand off…</option>
                {others.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {`${pet.avatar} ${pet.name}`}
                  </option>
                ))}
              </select>
            )}
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
