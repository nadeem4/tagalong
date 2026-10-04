import type { ContextSnapshot, Message, Pet } from '@tagalong/protocol';
import type { ConversationStore } from '../memory/store';
import type { ConversationRunner, TurnEventSink, TurnHandle } from '../conversation/runner';

/** What travels from one pet to another when the user hands a thread over. */
export interface HandoffPayload {
  fromPetId: string;
  toPetId: string;
  /** Two paragraphs: what the user asked, then what the source pet last said. */
  summary: string;
  /** The user's words after the mention. May be empty: "carry on from here". */
  request: string;
  /** The latest thing the user was looking at, so the target sees the same screen. */
  snapshot?: ContextSnapshot | undefined;
}

export interface HandoffInput {
  from: Pet;
  to: Pet;
  /** The thread being handed over. Absent when the user mentions a pet in a fresh panel. */
  conversationId?: string | undefined;
  request: string;
  /** What the user attached to this very ask, which beats anything older in the thread. */
  snapshot?: ContextSnapshot | undefined;
}

const QUESTION_CHARS = 300;
const ANSWER_CHARS = 700;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function textOf(message: Message): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim();
}

/** Where the user was, in a clause: "while reading “Launch post” (https://…)". */
function whereFrom(snapshot: ContextSnapshot | undefined): string {
  if (snapshot?.page) return ` while reading “${snapshot.page.title}” (${snapshot.page.url})`;
  if (snapshot?.app) {
    const title = snapshot.app.windowTitle ? ` — ${snapshot.app.windowTitle}` : '';
    return ` while in ${snapshot.app.name}${title}`;
  }
  return '';
}

/**
 * Builds the handoff from the stored thread, without a model call.
 *
 * Extractive on purpose: a summary written by a model would cost a paid call and seconds of
 * waiting before the target pet even starts, and the target is a model that reads a literal
 * extract perfectly well. Paragraph one is what the user asked and where; paragraph two is
 * the source pet's latest answer, clipped.
 */
export function buildHandoff(input: HandoffInput & { store: ConversationStore }): HandoffPayload {
  const messages =
    input.conversationId === undefined ? [] : input.store.listMessages(input.conversationId);
  const questions = messages.filter((message) => message.role === 'user').map(textOf);
  const answers = messages.filter((message) => message.role === 'assistant').map(textOf);
  const snapshot =
    input.snapshot ?? [...messages].reverse().find((message) => message.snapshot)?.snapshot;

  let summary: string;
  if (questions.length === 0) {
    summary =
      `The user had no earlier conversation with ${input.from.name} to hand over${whereFrom(snapshot)}.\n\n` +
      `${input.from.name} has not answered anything yet, so start from the request below.`;
  } else {
    const first = clip(questions[0] ?? '', QUESTION_CHARS);
    const latest = clip(questions.at(-1) ?? '', QUESTION_CHARS);
    const asked =
      questions.length > 1
        ? `They first asked: "${first}", and most recently: "${latest}".`
        : `They asked: "${first}".`;
    const answer = answers.at(-1);
    summary =
      `The user has been talking with ${input.from.name}${whereFrom(snapshot)}. ${asked}\n\n` +
      (answer === undefined
        ? `${input.from.name} had not answered yet.`
        : `${input.from.name}'s latest answer: "${clip(answer, ANSWER_CHARS)}"`);
  }

  return {
    fromPetId: input.from.id,
    toPetId: input.to.id,
    summary,
    request: input.request,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

/** The first message the target pet reads in its new conversation. */
function handoffPrompt(from: Pet, payload: HandoffPayload): string {
  const request = payload.request.length > 0 ? payload.request : 'Carry on from here.';
  return [
    `${from.name} handed this over to you.`,
    `What happened so far:\n${payload.summary}`,
    `The user's request: ${request}`,
  ].join('\n\n');
}

export interface HandoffDeps {
  runner: ConversationRunner;
  store: ConversationStore;
  emit: TurnEventSink;
}

/**
 * Hands a thread to another pet: builds the payload, opens a new conversation for the
 * target, announces the handoff as a `pet.message` — before the target's `turn.started`,
 * so a panel draws the bubble ahead of the answer — and lets the target answer.
 */
export function startHandoff(deps: HandoffDeps, input: HandoffInput): TurnHandle {
  const payload = buildHandoff({ ...input, store: deps.store });
  return deps.runner.run({
    pet: input.to,
    text: handoffPrompt(input.from, payload),
    snapshot: payload.snapshot,
    beforeStart: ({ turnId, conversationId }) =>
      deps.emit({
        method: 'pet.message',
        params: {
          fromPetId: payload.fromPetId,
          toPetId: payload.toPetId,
          kind: 'handoff',
          text: payload.summary,
          turnId,
          conversationId,
        },
      }),
  });
}
