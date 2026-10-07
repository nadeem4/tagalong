import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from '../memory/db';
import { ConversationStore } from '../memory/store';
import { SettingsStore } from '../settings/settings';
import { BrainError, FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import { ConversationRunner, type TurnEvent } from '../conversation/runner';
import { MAX_ROUNDS, startRoundtable } from './roundtable';

const base = {
  avatar: '*',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text' as const,
};
const scout: Pet = {
  ...base,
  id: 'scout',
  name: 'Scout',
  notes: 'You are Scout.',
  providerId: 'nebius',
  model: 'nvidia/nemotron-3-super-120b-a12b',
};
const ink: Pet = {
  ...base,
  id: 'ink',
  name: 'Ink',
  notes: 'You are Ink.',
  providerId: 'openrouter',
  model: 'anthropic/claude-sonnet-5',
};
const bolt: Pet = {
  ...base,
  id: 'bolt',
  name: 'Bolt',
  notes: 'You are Bolt.',
  providerId: 'nebius',
  model: 'nvidia/Nemotron-Nano-V2-12b',
};

let dir: string;
let db: Database;
let events: TurnEvent[];
let calls: { pet: string; model: string; request: BrainRequest }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-roundtable-'));
  db = openDatabase(dir);
  events = [];
  calls = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Each pet answers "<Name> says: round N" on its own model; `failing` pets throw. */
function runner(options: { failing?: string[]; delayMs?: number } = {}): ConversationRunner {
  return new ConversationRunner({
    store: new ConversationStore(db),
    settings: new SettingsStore(dir),
    provider: (pet): BrainProvider => ({
      id: pet.providerId,
      capabilities: { vision: true, tools: true, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: (req, handlers, signal) => {
        calls.push({ pet: pet.id, model: req.model, request: req });
        if (options.failing?.includes(pet.id)) {
          return Promise.reject(new BrainError('auth', `No key for ${pet.name}.`));
        }
        const n = calls.filter((call) => call.pet === pet.id).length;
        return new FakeBrainProvider({
          text: `${pet.name} view number ${n}`,
          delayMs: options.delayMs ?? 0,
        }).complete(req, handlers, signal);
      },
    }),
    emit: (event) => events.push(event),
  });
}

function lastUserText(request: BrainRequest): string {
  const last = request.messages.at(-1);
  return (last?.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('');
}

describe('startRoundtable', () => {
  it('lets each pet answer in turn, then ends with a synthesis by the pet that started', async () => {
    const r = runner();
    const run = startRoundtable(
      { runner: r, emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'Should the panel dock left?' },
    );
    const outcome = await run.done;

    expect(calls.map((call) => call.pet)).toEqual(['scout', 'ink', 'bolt', 'scout']);
    expect(outcome.state).toBe('done');
    expect(outcome.turns.map((turn) => [turn.petId, turn.round])).toEqual([
      ['scout', 1],
      ['ink', 1],
      ['bolt', 1],
      ['scout', 2],
    ]);
    expect(lastUserText(calls[3]!.request)).toMatch(/one-paragraph synthesis/i);
  });

  it('answers each pet on its own provider and model', async () => {
    await startRoundtable(
      { runner: runner(), emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'q' },
    ).done;

    expect(calls.slice(0, 3).map((call) => call.model)).toEqual([
      'nvidia/nemotron-3-super-120b-a12b',
      'anthropic/claude-sonnet-5',
      'nvidia/Nemotron-Nano-V2-12b',
    ]);
    const started = events.filter((event) => event.method === 'turn.started');
    expect(started.map((event) => event.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          petId: 'ink',
          providerId: 'openrouter',
          runId: expect.any(String),
        }),
      ]),
    );
  });

  it('shows every pet the answers given before its turn', async () => {
    await startRoundtable(
      { runner: runner(), emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'Tabs or spaces?' },
    ).done;

    expect(lastUserText(calls[0]!.request)).toContain('Tabs or spaces?');
    expect(lastUserText(calls[0]!.request)).not.toContain('view number');
    expect(lastUserText(calls[2]!.request)).toContain('Scout: Scout view number 1');
    expect(lastUserText(calls[2]!.request)).toContain('Ink: Ink view number 1');
    expect(lastUserText(calls[3]!.request)).toContain('Bolt: Bolt view number 1');
  });

  it('runs up to three rounds, two of discussion and the synthesis, and no more', async () => {
    const outcome = await startRoundtable(
      { runner: runner(), emit: (event) => events.push(event) },
      { starter: ink, pets: [ink, scout], question: 'q', rounds: 7 },
    ).done;

    expect(MAX_ROUNDS).toBe(3);
    expect(outcome.turns.map((turn) => `${turn.petId}:${turn.round}`)).toEqual([
      'ink:1',
      'scout:1',
      'ink:2',
      'scout:2',
      'ink:3',
    ]);
  });

  it('marks each round and reports progress and the model call count', async () => {
    const run = startRoundtable(
      { runner: runner(), emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink], question: 'q' },
    );
    await run.done;

    const rounds = events.filter((event) => event.method === 'pet.message');
    expect(rounds.map((event) => event.params)).toEqual([
      expect.objectContaining({
        kind: 'roundtable',
        round: 1,
        text: 'Round 1 of 2',
        runId: run.runId,
      }),
      expect.objectContaining({ kind: 'roundtable', round: 2, text: 'Synthesis by Scout' }),
    ]);
    // Each round marker precedes the turn that opens the round.
    const order = events.map((event) => event.method);
    expect(order.indexOf('pet.message')).toBeLessThan(order.indexOf('turn.started'));

    const statuses = events
      .filter((event) => event.method === 'crew.status')
      .map((event) => event.params);
    expect(statuses[0]).toMatchObject({ state: 'running', round: 0, rounds: 2, modelCalls: 0 });
    expect(statuses.at(-1)).toMatchObject({ state: 'done', modelCalls: 3 });
  });

  it('cancels the remaining turns when the user stops it', async () => {
    const r = runner({ delayMs: 5 });
    const run = startRoundtable(
      { runner: r, emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'q' },
    );

    run.stop();
    const outcome = await run.done;

    expect(outcome.state).toBe('stopped');
    expect(calls.map((call) => call.pet)).toEqual(['scout']);
    expect(events.filter((e) => e.method === 'crew.status').at(-1)?.params).toMatchObject({
      state: 'stopped',
    });
  });

  it('stops too when the turn in flight is interrupted, as the panel’s Stop button does', async () => {
    const r = runner({ delayMs: 5 });
    const run = startRoundtable(
      { runner: r, emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'q' },
    );

    r.interrupt(run.firstTurnId);
    const outcome = await run.done;

    expect(outcome.state).toBe('stopped');
    expect(calls).toHaveLength(1);
  });

  it('carries on past a pet that cannot answer, and says so in the transcript', async () => {
    const outcome = await startRoundtable(
      { runner: runner({ failing: ['ink'] }), emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink, bolt], question: 'q' },
    ).done;

    expect(outcome.state).toBe('done');
    expect(calls.map((call) => call.pet)).toEqual(['scout', 'ink', 'bolt', 'scout']);
    expect(lastUserText(calls[2]!.request)).toContain('Ink could not answer');
  });

  it('does not offer ask_pet during a roundtable', async () => {
    await startRoundtable(
      { runner: runner(), emit: (event) => events.push(event) },
      { starter: scout, pets: [scout, ink], question: 'q' },
    ).done;

    for (const call of calls) {
      expect(call.request.tools?.map((tool) => tool.name) ?? []).not.toContain('ask_pet');
    }
  });
});
