/**
 * Conversations and messages in SQLite (ConversationStore): append, replay history,
 * summaries and the screenshot retention sweep.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ContextSnapshot,
  MessageContent,
  MessageRole,
  ScreenshotRetention,
} from '@tagalong/protocol';
import { Conversation, Message } from '@tagalong/protocol';
import { hasPixels, withoutPixels } from '../perception/retention';

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

const MS_PER_HOUR = 60 * 60 * 1000;

/** Sorts after every real `created_at`, which is how "sweep everything" is expressed. */
const MAX_TIMESTAMP = '9999-12-31T23:59:59.999Z';

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

  /**
   * Drops screenshots that have outlived the retention setting, and returns how many rows
   * changed. Only the image goes: the rest of the snapshot is what the conversation was
   * about, and deleting it would leave answers with no question behind them.
   *
   * Takes `now` so a test can age a row without waiting, and so a caller sweeping several
   * things at once uses one consistent instant. No timer lives here: the runner calls it at
   * the start of each turn.
   */
  purgeExpiredScreenshots(retention: ScreenshotRetention, now: Date = new Date()): number {
    // 'off' sweeps everything: the setting was turned off, so what was kept under it goes.
    const cutoff =
      retention.mode === 'off'
        ? MAX_TIMESTAMP
        : new Date(now.getTime() - retention.hours * MS_PER_HOUR).toISOString();

    const rows = this.db
      .prepare<[string], Pick<MessageRow, 'id' | 'snapshot_json'>>(
        'SELECT id, snapshot_json FROM messages WHERE snapshot_json IS NOT NULL AND created_at < ?',
      )
      .all(cutoff);

    const update = this.db.prepare<[string, string]>(
      'UPDATE messages SET snapshot_json = ? WHERE id = ?',
    );

    let purged = 0;
    for (const row of rows) {
      if (row.snapshot_json === null) continue;
      const snapshot = JSON.parse(row.snapshot_json) as ContextSnapshot;
      // A dropped image goes with the screenshots, by the same rule.
      if (!hasPixels(snapshot)) continue;
      update.run(JSON.stringify(withoutPixels(snapshot)), row.id);
      purged += 1;
    }
    return purged;
  }

  /**
   * The newest `limit` messages not yet folded into a summary, returned oldest first so
   * they can be replayed as-is. Summarized messages stay on disk; the summary memory
   * stands in for them in the prompt.
   */
  lastMessages(conversationId: string, limit: number): Message[] {
    return this.db
      .prepare<[string, number], MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = ? AND summarized_at IS NULL
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse()
      .map(toMessage);
  }

  /** Every message of a conversation not yet folded into a summary, oldest first. */
  unsummarizedMessages(conversationId: string): Message[] {
    return this.db
      .prepare<[string], MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = ? AND summarized_at IS NULL ${ORDERED}`,
      )
      .all(conversationId)
      .map(toMessage);
  }

  /** Marks messages as folded into a summary. Returns how many rows changed. */
  markSummarized(ids: readonly string[], at: Date = new Date()): number {
    const update = this.db.prepare<[string, string]>(
      'UPDATE messages SET summarized_at = ? WHERE id = ? AND summarized_at IS NULL',
    );
    let changed = 0;
    this.db.transaction(() => {
      for (const id of ids) changed += update.run(at.toISOString(), id).changes;
    })();
    return changed;
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
