/**
 * `remember`: files a fact or preference the user states, under the pet that asked.
 * `forget`: lists memories by query, or deletes one by id. Both `write`: they change what
 * outlives the turn.
 */
import type { BrainTool } from '../../providers';
import type { Memory, MemoryKind, MemoryStore } from '../../memory/memories';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const REMEMBER = 'remember';

const REMEMBER_DEFINITION: BrainTool = {
  name: REMEMBER,
  description:
    'Save something worth knowing in later conversations: a preference the user states ' +
    '("I prefer short answers"), or a lasting fact about them or their work. Do not save ' +
    'what is only on screen right now.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'One short sentence, in your own words.' },
      kind: { type: 'string', enum: ['fact', 'preference'] },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

const SAVABLE_KINDS: readonly MemoryKind[] = ['fact', 'preference'];

export const FORGET = 'forget';

const FORGET_DEFINITION: BrainTool = {
  name: FORGET,
  description:
    'Delete something you remember about them, for good. With query: lists up to 5 matching ' +
    'memories with their ids and deletes nothing. With id: deletes that one memory.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words from the memory.' },
      id: { type: 'string', description: 'The id from a listing, like m-3fa1c2d0.' },
    },
    additionalProperties: false,
  },
};

/** How many matches a query lists. */
const FORGET_MATCHES = 5;

/** The id the model sees and says back: `m-` and the first 8 characters of the uuid. */
function shortId(id: string): string {
  return `m-${id.slice(0, 8)}`;
}

function line(memory: Memory): string {
  return `${shortId(memory.id)} (${memory.kind}) ${memory.text}`;
}

/**
 * The `forget` tool: a query lists matches and deletes nothing, an id deletes one memory of
 * the pet that called it. Deleting is a tightening step, so it shows no card.
 */
export function forgetTool(memories: MemoryStore): Tool {
  return defineTool(FORGET_DEFINITION, 'write', (input, ctx): Promise<ToolOutcome> => {
    const fields = (input !== null && typeof input === 'object' ? input : {}) as {
      query?: unknown;
      id?: unknown;
    };
    const id = typeof fields.id === 'string' ? fields.id.trim() : '';
    const query = typeof fields.query === 'string' ? fields.query.trim() : '';
    if (id !== '') {
      const found = memories.byPrefix(ctx.pet.id, id.replace(/^m-/, ''));
      if (found.length === 0) {
        return Promise.resolve({ content: `No memory has the id ${id}.`, isError: true });
      }
      if (found.length > 1) {
        return Promise.resolve({
          content: `${id} matches 2 memories: ${found.map(line).join('; ')}. Nothing deleted.`,
          isError: true,
        });
      }
      const memory = found[0]!;
      memories.delete(memory.id);
      return Promise.resolve({ content: `Deleted: "${memory.text}".` });
    }
    if (query === '') {
      return Promise.resolve({
        content: 'Nothing deleted: neither a query nor an id was given.',
        isError: true,
      });
    }
    const matches = memories.search(ctx.pet.id, query, FORGET_MATCHES);
    if (matches.length === 0) {
      return Promise.resolve({ content: `No memory matches "${query}". Nothing deleted.` });
    }
    return Promise.resolve({
      content: `Memories matching "${query}". Nothing deleted:\n${matches
        .map((memory) => `- ${line(memory)}`)
        .join('\n')}`,
    });
  });
}

/** The `remember` tool, filing under the pet that called it. */
export function rememberTool(memories: MemoryStore): Tool {
  return defineTool(REMEMBER_DEFINITION, 'write', (input, ctx): Promise<ToolOutcome> => {
    const fields = (input ?? {}) as { text?: unknown; kind?: unknown };
    const text = typeof fields.text === 'string' ? fields.text.trim() : '';
    if (text.length === 0) {
      return Promise.resolve({ content: 'Nothing saved: text is required.', isError: true });
    }
    const kind = SAVABLE_KINDS.find((candidate) => candidate === fields.kind) ?? 'fact';
    memories.addOnce({ petId: ctx.pet.id, kind, text });
    return Promise.resolve({ content: 'Saved to your memory.' });
  });
}
