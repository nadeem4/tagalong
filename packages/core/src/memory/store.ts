import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContextSnapshot, MessageContent, MessageRole } from '@tagalong/protocol';
import { Conversation, Message } from '@tagalong/protocol';

interface ConversationRow {
  id: string;
  pet_id: string;
  title: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content_json: string;
  snapshot_json: string | null;
  created_at: string;
}

export interface NewConversation {
  petId: string;
  title?: string | null;
}

export interface NewMessage {
  conversationId: string;
  role: MessageRole;
  content: MessageContent[];
  snapshot?: ContextSnapshot;
}

/** Rows are ordered by time, with rowid breaking ties inside the same millisecond. */
const ORDERED = 'ORDER BY created_at ASC, rowid ASC';

/**
 * Conversations and messages on top of the migrated SQLite file.
 *
 * Everything is re-validated through the protocol schemas on the way out: the JSON
 * columns are opaque to SQLite, so an older or hand-edited row is caught here rather
 * than halfway through a model call.
 */
export class ConversationStore {
  constructor(private readonly db: Database.Database) {}

  createConversation(input: NewConversation): Conversation {
    const row: ConversationRow = {
      id: randomUUID(),
      pet_id: input.petId,
      title: input.title ?? null,
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare('INSERT INTO conversations (id, pet_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(row.id, row.pet_id, row.title, row.created_at);
    return toConversation(row);
  }

  getConversation(id: string): Conversation | null {
    const row = this.db
      .prepare<[string], ConversationRow>('SELECT * FROM conversations WHERE id = ?')
      .get(id);
    return row ? toConversation(row) : null;
  }

  appendMessage(input: NewMessage): Message {
    const message = Message.parse({
      id: randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      ...(input.snapshot ? { snapshot: input.snapshot } : {}),
      createdAt: new Date().toISOString(),
    });

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content_json, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        JSON.stringify(message.content),
        message.snapshot ? JSON.stringify(message.snapshot) : null,
        message.createdAt,
      );

    return message;
  }

  /** Every message of a conversation, oldest first. */
  listMessages(conversationId: string): Message[] {
    return this.db
      .prepare<[string], MessageRow>(`SELECT * FROM messages WHERE conversation_id = ? ${ORDERED}`)
      .all(conversationId)
      .map(toMessage);
  }

  /** The newest `limit` messages, returned oldest first so they can be replayed as-is. */
  lastMessages(conversationId: string, limit: number): Message[] {
    return this.db
      .prepare<[string, number], MessageRow>(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      )
      .all(conversationId, limit)
      .reverse()
      .map(toMessage);
  }
}

function toConversation(row: ConversationRow): Conversation {
  return Conversation.parse({
    id: row.id,
    petId: row.pet_id,
    title: row.title,
    createdAt: row.created_at,
  });
}

function toMessage(row: MessageRow): Message {
  return Message.parse({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: JSON.parse(row.content_json),
    ...(row.snapshot_json === null ? {} : { snapshot: JSON.parse(row.snapshot_json) }),
    createdAt: row.created_at,
  });
}
