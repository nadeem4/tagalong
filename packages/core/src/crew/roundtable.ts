import { randomUUID } from 'node:crypto';
import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import type {
  ConversationRunner,
  TurnEventSink,
  TurnHandle,
  TurnOutcome,
} from '../conversation/runner';

/** One discussion round plus the synthesis. */
export const DEFAULT_ROUNDS = 2;

/** Two discussion rounds plus the synthesis: the most a roundtable ever runs. */
export const MAX_ROUNDS = 3;

/** Each answer is clipped to this in the transcript the next speaker reads. */
const TRANSCRIPT_ANSWER_CHARS = 800;

export interface RoundtableInput {
  /** Speaks first and writes the synthesis. */
  starter: Pet;
  /** Everyone at the table, in speaking order; the starter is moved to the front. */
  pets: readonly Pet[];
  question: string;
  /** What the user was looking at. Rides on each pet's first turn only. */
  snapshot?: ContextSnapshot | undefined;
  /** Rounds including the synthesis, clamped to 2..3. */
  rounds?: number | undefined;
}

export interface RoundtableTurn {
  petId: string;
  round: number;
  text: string;
  /** Set when the pet could not answer; the table carries on without it. */
  failed?: string;
}

export interface RoundtableOutcome {
  runId: string;
  state: 'done' | 'stopped';
  turns: RoundtableTurn[];
  modelCalls: number;
}

export interface RoundtableRun {
  runId: string;
  /** The first speaker's turn, started before this returns, so an ask can report it. */
  firstTurnId: string;
  /** Settles when the table finishes or is stopped. Never rejects. */
  done: Promise<RoundtableOutcome>;
  /** Stops the turn in flight and cancels every turn after it. */
  stop(): void;
}

export interface RoundtableDeps {
  runner: ConversationRunner;
  emit: TurnEventSink;
}

interface Step {
  pet: Pet;
  round: number;
  synthesis: boolean;
}

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function transcriptOf(turns: readonly RoundtableTurn[], pets: readonly Pet[], rounds: boolean) {
  return turns
    .map((turn) => {
      const name = pets.find((pet) => pet.id === turn.petId)?.name ?? turn.petId;
      const label = rounds ? `${name} (round ${turn.round})` : name;
      return turn.failed !== undefined
        ? `${label}: (${name} could not answer: ${turn.failed})`
        : `${label}: ${clip(turn.text, TRANSCRIPT_ANSWER_CHARS)}`;
    })
    .join('\n\n');
}

function promptFor(
  step: Step,
  input: RoundtableInput,
  pets: readonly Pet[],
  turns: readonly RoundtableTurn[],
  totalRounds: number,
): string {
  const asked = `The user put this question to the whole crew: "${input.question}"`;
  if (step.synthesis) {
    return [
      asked,
      `The crew's answers:\n${transcriptOf(turns, pets, totalRounds > 2)}`,
      'You started this roundtable. Write a one-paragraph synthesis: where the crew agrees, ' +
        'where it differs, and what you recommend. One paragraph, no lists.',
    ].join('\n\n');
  }
  if (turns.length === 0) {
    return [
      asked,
      `You speak first at a roundtable with ${pets.map((pet) => pet.name).join(', ')}. ` +
        'Give your own view in a few sentences, from your role.',
    ].join('\n\n');
  }
  const instruction =
    step.round === 1
      ? 'Give your own view in a few sentences, from your role. Add what the others have not ' +
        'said, and disagree where you do.'
      : `This is round ${step.round}. Respond briefly to the others: refine, concede, or push back.`;
  return [
    asked,
    `Answers so far:\n${transcriptOf(turns, pets, totalRounds > 2)}`,
    instruction,
  ].join('\n\n');
}

/**
 * Puts one question to the whole crew.
 *
 * Every pet answers in turn on its own provider and model, each seeing the answers before
 * it; with three rounds, a second pass lets them respond to each other; the pet that
 * started closes with a one-paragraph synthesis. Each pet keeps its own conversation for
 * the run, so a later round continues where its first answer left off. Round markers go out
 * as `pet.message` before the turn that opens the round, and `crew.status` reports progress
 * and the running model-call count. A pet that cannot answer — no key, say — is noted in the
 * transcript and the table carries on; an interrupted turn, or `stop()`, ends the run.
 */
export function startRoundtable(deps: RoundtableDeps, input: RoundtableInput): RoundtableRun {
  const runId = randomUUID();
  const pets = [input.starter, ...input.pets.filter((pet) => pet.id !== input.starter.id)];
  const totalRounds = Math.min(MAX_ROUNDS, Math.max(2, input.rounds ?? DEFAULT_ROUNDS));

  const steps: Step[] = [];
  for (let round = 1; round < totalRounds; round += 1) {
    for (const pet of pets) steps.push({ pet, round, synthesis: false });
  }
  steps.push({ pet: input.starter, round: totalRounds, synthesis: true });

  const turns: RoundtableTurn[] = [];
  const conversations = new Map<string, string>();
  let modelCalls = 0;
  let stopped = false;
  let current: TurnHandle | null = null;

  const status = (state: 'running' | 'done' | 'stopped', round: number): void =>
    deps.emit({
      method: 'crew.status',
      params: { runId, kind: 'roundtable', state, round, rounds: totalRounds, modelCalls },
    });

  const launch = (index: number): TurnHandle => {
    const step = steps[index] as Step;
    const opensRound = index === 0 || steps[index - 1]?.round !== step.round;
    const firstForPet = !conversations.has(step.pet.id);
    const handle = deps.runner.run({
      pet: step.pet,
      text: promptFor(step, input, pets, turns, totalRounds),
      conversationId: conversations.get(step.pet.id),
      snapshot: firstForPet ? input.snapshot : undefined,
      runId,
      allowConsult: false,
      beforeStart: () => {
        if (!opensRound) return;
        deps.emit({
          method: 'pet.message',
          params: {
            fromPetId: input.starter.id,
            toPetId: step.pet.id,
            kind: 'roundtable',
            text: step.synthesis
              ? `Synthesis by ${input.starter.name}`
              : `Round ${step.round} of ${totalRounds}`,
            runId,
            round: step.round,
          },
        });
      },
    });
    conversations.set(step.pet.id, handle.conversationId);
    current = handle;
    return handle;
  };

  status('running', 0);
  const first = launch(0);

  const done = (async (): Promise<RoundtableOutcome> => {
    let handle: TurnHandle = first;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] as Step;
      const outcome: TurnOutcome = await handle.done;
      modelCalls += outcome.modelCalls ?? (outcome.stopReason === 'error' ? 1 : 0);
      if (stopped || outcome.stopReason === 'aborted') {
        stopped = true;
        break;
      }
      turns.push({
        petId: step.pet.id,
        round: step.round,
        text: outcome.text,
        ...(outcome.error === undefined ? {} : { failed: outcome.error.message }),
      });
      status('running', step.round);
      if (index + 1 < steps.length) handle = launch(index + 1);
    }
    const state = stopped ? 'stopped' : 'done';
    status(state, turns.at(-1)?.round ?? 0);
    return { runId, state, turns, modelCalls };
  })();

  return {
    runId,
    firstTurnId: first.turnId,
    done,
    stop: () => {
      stopped = true;
      if (current !== null) deps.runner.interrupt(current.turnId);
    },
  };
}
