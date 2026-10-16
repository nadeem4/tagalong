/**
 * `remember`: files a fact or preference the user states, under the pet that asked, or for
 * every pet when the model sets `shared`. `write`, because the memory outlives the turn.
 */
import type { BrainTool } from '../../providers';
import type { MemoryKind, MemoryStore } from '../../memory/memories';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const REMEMBER = 'remember';

const REMEMBER_DEFINITION: BrainTool = {
  name: REMEMBER,
  description:
    'Save something worth knowing in later conversations: a preference the user states ' +
    '("I prefer short answers"), or a lasting fact about them or their work. Do not save ' +
    'what is only on screen right now. Set shared to true to write it in the crew notebook ' +
    'so every pet knows it; otherwise only you remember it.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'One short sentence, in your own words.' },
      kind: { type: 'string', enum: ['fact', 'preference'] },
      shared: { type: 'boolean' },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

const SAVABLE_KINDS: readonly MemoryKind[] = ['fact', 'preference'];

/** The `remember` tool, filing under the pet that called it. */
export function rememberTool(memories: MemoryStore): Tool {
  return defineTool(REMEMBER_DEFINITION, 'write', (input, ctx): Promise<ToolOutcome> => {
    const fields = (input ?? {}) as { text?: unknown; kind?: unknown; shared?: unknown };
    const text = typeof fields.text === 'string' ? fields.text.trim() : '';
    if (text.length === 0) {
      return Promise.resolve({ content: 'Nothing saved: text is required.', isError: true });
    }
    const kind = SAVABLE_KINDS.find((candidate) => candidate === fields.kind) ?? 'fact';
    const shared = fields.shared === true;
    memories.addOnce(
      shared ? { scope: 'crew', kind, text } : { scope: 'pet', petId: ctx.pet.id, kind, text },
    );
    return Promise.resolve({
      content: shared ? 'Saved to the crew notebook.' : 'Saved to your memory.',
    });
  });
}
