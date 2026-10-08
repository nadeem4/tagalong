import { randomUUID } from 'node:crypto';
import type { ContextSnapshot, Pet, Settings } from '@tagalong/protocol';
import type { BrainProvider, BrainTool } from '../../providers';
import { BrainError } from '../../providers';
import type { MemoryKind, MemoryStore } from '../../memory/memories';
import { recall } from '../../memory/recall';
import { assemblePrompt } from '../../conversation/prompt-assembler';
import { roleFor } from '../../roles';
import { defineTool, type Tool, type ToolContext, type ToolOutcome } from '../tool';

/**
 * The crew tools: the ones that need to know which pet is asking. `remember` files a
 * memory under it (`write`); `ask_pet` consults another pet and stores nothing (`read`).
 */

export const REMEMBER = 'remember';
export const ASK_PET = 'ask_pet';

/** How long a consulted pet has to answer before the caller is told to carry on alone. */
export const CONSULT_TIMEOUT_MS = 60_000;

/** What a consulted pet is told when it tries to consult in turn. Depth is limited to one. */
export const NESTED_CONSULT_REFUSED =
  'A consulted pet cannot consult another pet. Answer from what you know.';

// ---------------------------------------------------------------------------------------
// remember.

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

// ---------------------------------------------------------------------------------------
// ask_pet.

export interface AskPetDeps {
  /** The whole crew, read per call so a pet added in Settings can be asked at once. */
  pets: () => readonly Pet[];
  provider: (pet: Pet) => BrainProvider;
  settings: () => Settings;
  memory?: MemoryStore | undefined;
  timeoutMs?: number | undefined;
  /** Announces the consult so the panel can draw its card. */
  announce?: ((from: Pet, to: Pet, question: string, turnId: string) => void) | undefined;
  /** Home. The consulted pet's reply, or why there was none, for the activity record. */
  answered?:
    ((turnId: string, toPetId: string, outcome: { ok: boolean; text: string }) => void) | undefined;
}

/**
 * How a pet picks who to ask, from the directory design. Rules apply in order, so a
 * better role match never beats a pet that cannot reach the tool the job needs.
 */
const CHOOSING_RULES =
  'To choose: only a pet that can reach the tool the job needs can do it; among those, ask ' +
  'the best role match; a task needing two roles means asking both; on a tie, ask the one ' +
  'on the cheaper brain; if no one fits, say so rather than ask the wrong pet.';

/**
 * A teammate's directory card: name, role, summary, good at, not for. Built from the role
 * only, so the pet's private notes and memories never reach another pet's prompt. The id
 * leads because it is what the tool's `petId` takes.
 */
function card(pet: Pet): string {
  const role = roleFor(pet.roleId);
  return (
    `${pet.id}: ${pet.name}, ${role.name}. ${role.summary} ` +
    `Good at: ${role.goodAt.join(', ')}. Not for: ${role.notFor.join(', ')}.`
  );
}

function definitionFor(caller: Pet, crew: readonly Pet[]): BrainTool {
  const cards = crew
    .filter((pet) => pet.id !== caller.id)
    .map((pet) => `- ${card(pet)}`)
    .join('\n');
  return {
    name: ASK_PET,
    description:
      'Ask another pet of the crew a question mid-answer and get its reply back, for when ' +
      'its role fits part of the job better. The user sees that you asked. Ask one focused ' +
      `question; it answers once. ${CHOOSING_RULES}\nPets you can ask:\n${cards}`,
    inputSchema: {
      type: 'object',
      properties: {
        petId: { type: 'string', description: 'The id of the pet to ask.' },
        question: { type: 'string', description: 'The question, with any text it needs.' },
      },
      required: ['petId', 'question'],
      additionalProperties: false,
    },
  };
}

/** The context a consulted pet gets: the words on screen, never the pixels. */
function textOnly(snapshot: ContextSnapshot | undefined): ContextSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  const { screenshot: _s, composite: _c, displays: _d, ...rest } = snapshot;
  return rest;
}

/**
 * The `ask_pet` tool for one caller; its description lists the pets that caller can ask.
 * Runs a single nested turn for the consulted pet — its own role, notes, provider, model and
 * memories — with no tools at all, so a consulted pet cannot consult in turn (depth limit 1)
 * and a nested call it invents is refused. The nested turn has 60 seconds; past that, or on
 * any failure, the caller gets an error result and carries on answering alone. Nothing is
 * stored: the caller's answer is the record.
 */
export function askPetTool(deps: AskPetDeps, caller: Pet): Tool {
  return defineTool(
    definitionFor(caller, deps.pets()),
    'read',
    async (input, ctx): Promise<ToolOutcome> => {
      const fields = (input ?? {}) as { petId?: unknown; question?: unknown };
      const question = typeof fields.question === 'string' ? fields.question.trim() : '';
      const askable = deps.pets().filter((pet) => pet.id !== ctx.pet.id);
      const target = askable.find((pet) => pet.id === fields.petId);
      if (target === undefined) {
        return {
          content: `No pet with that id can be asked. Ask one of: ${askable.map((pet) => pet.id).join(', ')}.`,
          isError: true,
        };
      }
      if (question.length === 0) return { content: 'Ask a question.', isError: true };

      deps.announce?.(ctx.pet, target, question, ctx.turnId);
      ctx.countCall();
      const outcome = await consult(deps, ctx, target, question);
      deps.answered?.(ctx.turnId, target.id, {
        ok: outcome.isError !== true,
        text: typeof outcome.content === 'string' ? outcome.content : '',
      });
      return outcome;
    },
  );
}

/** The nested turn itself: the consulted pet's one answer, or an error result. */
async function consult(
  deps: AskPetDeps,
  ctx: ToolContext,
  target: Pet,
  question: string,
): Promise<ToolOutcome> {
  const timeoutMs = deps.timeoutMs ?? CONSULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([ctx.signal, timeout]);
  const settings = deps.settings();
  const asked = `${ctx.pet.name} is consulting you mid-answer. Your reply goes back to ${ctx.pet.name}, not to the user, so answer the question directly and briefly.\n\nQuestion: ${question}`;
  const request = assemblePrompt({
    pet: target,
    history: [
      {
        id: randomUUID(),
        conversationId: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: asked }],
        createdAt: new Date().toISOString(),
      },
    ],
    settings,
    memories: deps.memory ? recall(deps.memory, target.id, question) : [],
    snapshot: textOnly(ctx.snapshot),
  });

  try {
    const provider = deps.provider(target);
    const result = await provider.complete(
      request,
      {
        onText: () => undefined,
        onToolUse: (call) =>
          Promise.resolve({
            content: call.name === ASK_PET ? NESTED_CONSULT_REFUSED : 'No tools in a consult.',
            isError: true,
          }),
      },
      signal,
    );
    if (timeout.aborted) return timedOut(target, timeoutMs);
    if (ctx.signal.aborted) return { content: 'The consult was stopped.', isError: true };
    if (result.text.trim().length === 0) {
      return { content: `${target.name} gave no answer.`, isError: true };
    }
    return { content: result.text };
  } catch (error) {
    if (timeout.aborted) return timedOut(target, timeoutMs);
    const message =
      error instanceof BrainError || error instanceof Error ? error.message : String(error);
    return { content: `${target.name} could not answer: ${message}`, isError: true };
  }
}

function timedOut(target: Pet, timeoutMs: number): ToolOutcome {
  return {
    content: `${target.name} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Answer without it.`,
    isError: true,
  };
}
