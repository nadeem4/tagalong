import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import type { BrainTool } from '../providers';
import type { MemoryKind, MemoryStore } from '../memory/memories';
import type { ToolOutcome } from '../perception';

/**
 * One tool the crew layer adds to a turn. Unlike the perception tools, these need to know
 * which pet is asking — memories are filed under it, and a consult must know its caller.
 */
export interface CrewTool {
  readonly definition: BrainTool;
  run(input: unknown, turn: CrewToolTurn): Promise<ToolOutcome>;
}

export interface CrewToolTurn {
  pet: Pet;
  turnId: string;
  signal: AbortSignal;
  snapshot?: ContextSnapshot | undefined;
}

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
export function rememberTool(memories: MemoryStore): CrewTool {
  return {
    definition: REMEMBER_DEFINITION,
    run(input, turn): Promise<ToolOutcome> {
      const fields = (input ?? {}) as { text?: unknown; kind?: unknown; shared?: unknown };
      const text = typeof fields.text === 'string' ? fields.text.trim() : '';
      if (text.length === 0) {
        return Promise.resolve({ content: 'Nothing saved: text is required.', isError: true });
      }
      const kind = SAVABLE_KINDS.find((candidate) => candidate === fields.kind) ?? 'fact';
      const shared = fields.shared === true;
      memories.addOnce(
        shared ? { scope: 'crew', kind, text } : { scope: 'pet', petId: turn.pet.id, kind, text },
      );
      return Promise.resolve({
        content: shared ? 'Saved to the crew notebook.' : 'Saved to your memory.',
      });
    },
  };
}
