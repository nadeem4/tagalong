import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from '../../memory/db';
import { ConversationStore } from '../../memory/store';
import { SettingsStore } from '../../settings/settings';
import { BrainError, FakeBrainProvider } from '../../providers';
import type { BrainProvider, BrainRequest, FakeScript } from '../../providers';
import { ConversationRunner, type TurnEvent } from '../../conversation/runner';
import type { ToolOutcome } from '../tool';
import { getRole } from '../../roles';
import { ASK_PET } from './crew';

const base = {
  avatar: '*',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text' as const,
};
const bolt: Pet = {
  ...base,
  id: 'bolt',
  name: 'Bolt',
  notes: 'You are Bolt.',
  model: 'bolt-model',
  providerId: 'nebius',
};
const ink: Pet = {
  ...base,
  id: 'ink',
  name: 'Ink',
  roleId: 'writer',
  notes: 'You are Ink, the writer.',
  model: 'ink-model',
  providerId: 'openrouter',
};
const crew = [bolt, ink];

let dir: string;
let db: Database;
let events: TurnEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-consult-'));
  db = openDatabase(dir);
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Brain {
  provider: BrainProvider;
  requests: BrainRequest[];
  toolResults: ToolOutcome[];
}

/** A scripted brain per provider id, recording what it was sent and what tools returned. */
function brain(script: FakeScript | (() => Promise<never>)): Brain {
  const requests: BrainRequest[] = [];
  const toolResults: ToolOutcome[] = [];
  const fake = new FakeBrainProvider(typeof script === 'function' ? { text: '' } : script);
  return {
    requests,
    toolResults,
    provider: {
      id: 'fake',
      capabilities: fake.capabilities,
      listModels: () => fake.listModels(),
      complete: (req, handlers, signal) => {
        requests.push(req);
        if (typeof script === 'function') return script();
        return fake.complete(
          req,
          {
            onText: (delta) => handlers.onText(delta),
            onToolUse: async (call) => {
              const result = await handlers.onToolUse(call);
              toolResults.push(result);
              return result;
            },
          },
          signal,
        );
      },
    },
  };
}

/** Every consult answer the runner reported, for Home's activity record. */
let answers: { turnId: string; toPetId: string; ok: boolean; text: string }[] = [];

function runnerWith(brains: Record<string, Brain>, timeoutMs?: number): ConversationRunner {
  return new ConversationRunner({
    store: new ConversationStore(db),
    settings: new SettingsStore(dir),
    provider: (pet) => {
      const found = brains[pet.providerId];
      if (found === undefined) throw new BrainError('config', `no brain for ${pet.providerId}`);
      return found.provider;
    },
    emit: (event) => events.push(event),
    consult: {
      pets: () => crew,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      answered: (turnId, toPetId, outcome) => answers.push({ turnId, toPetId, ...outcome }),
    },
  });
}

const askInk = (question: string) => ({
  id: 'consult-1',
  name: ASK_PET,
  input: { petId: 'ink', question },
});

describe('ask_pet', () => {
  it('runs a nested turn for the consulted pet on its own brain and returns its text', async () => {
    const boltBrain = brain({
      text: 'Here is the polished fix note.',
      toolCall: askInk('Polish this commit message: fix bug'),
    });
    const inkBrain = brain({ text: 'Fix the off-by-one in pagination.' });

    const turn = runnerWith({ nebius: boltBrain, openrouter: inkBrain }).run({
      pet: bolt,
      text: 'Write a commit message for this fix',
    });
    const outcome = await turn.done;

    expect(boltBrain.requests[0]?.tools?.map((tool) => tool.name)).toContain(ASK_PET);
    expect(inkBrain.requests[0]?.model).toBe('ink-model');
    expect(inkBrain.requests[0]?.system).toContain('You are Ink, the writer.');
    expect(JSON.stringify(inkBrain.requests[0]?.messages)).toContain('Polish this commit message');
    expect(boltBrain.toolResults[0]).toEqual({ content: 'Fix the off-by-one in pagination.' });
    expect(outcome.text).toBe('Here is the polished fix note.');
  });

  it('describes each teammate by a card from its role, never by its notes', async () => {
    const boltBrain = brain({ text: 'ok' });
    const crewOfThree = [bolt, ink, { ...ink, id: 'pip', name: 'Pip', roleId: 'astronaut' }];

    await new ConversationRunner({
      store: new ConversationStore(db),
      settings: new SettingsStore(dir),
      provider: () => boltBrain.provider,
      emit: () => undefined,
      consult: { pets: () => crewOfThree },
    }).run({ pet: { ...bolt, providerId: 'nebius' }, text: 'hi' }).done;

    const description =
      boltBrain.requests[0]?.tools?.find((tool) => tool.name === ASK_PET)?.description ?? '';
    const writer = getRole('writer')!;
    expect(description).toContain(
      `ink: Ink, ${writer.name}. ${writer.summary} Good at: ${writer.goodAt.join(', ')}. ` +
        `Not for: ${writer.notFor.join(', ')}.`,
    );
    expect(description).toContain(`pip: Pip, ${getRole('generalist')!.name}.`);
    expect(description).not.toContain('bolt:');
    expect(description).not.toContain('You are Ink');
    expect(description).toMatch(/only a pet that can reach the tool/i);
    expect(description).toMatch(/cheaper brain/i);
    expect(description).toMatch(/no one fits/i);
  });

  it('announces the consult as a pet.message tied to the caller’s turn, and counts the calls', async () => {
    const turn = runnerWith({
      nebius: brain({ text: 'Done.', toolCall: askInk('Is this clear?') }),
      openrouter: brain({ text: 'Yes.' }),
    }).run({ pet: bolt, text: 'hi' });
    await turn.done;

    const consult = events.find((event) => event.method === 'pet.message');
    expect(consult?.params).toEqual({
      fromPetId: 'bolt',
      toPetId: 'ink',
      kind: 'consult',
      text: 'Is this clear?',
      turnId: turn.turnId,
    });
    const completed = events.find((event) => event.method === 'turn.completed');
    // Bolt's first call, Ink's nested call, and Bolt's call after the tool result.
    expect(completed?.params).toMatchObject({ modelCalls: 3 });
  });

  it('reports the answer, or why there was none, so the activity view can show it', async () => {
    answers = [];
    const answered = runnerWith({
      nebius: brain({ text: 'Done.', toolCall: askInk('Is this clear?') }),
      openrouter: brain({ text: 'Yes, very.' }),
    }).run({ pet: bolt, text: 'hi' });
    await answered.done;
    const failed = runnerWith({
      nebius: brain({ text: 'ok', toolCall: askInk('q') }),
      openrouter: brain(() => Promise.reject(new BrainError('auth', 'No OpenRouter key.'))),
    }).run({ pet: bolt, text: 'hi' });
    await failed.done;

    expect(answers[0]).toEqual({
      turnId: answered.turnId,
      toPetId: 'ink',
      ok: true,
      text: 'Yes, very.',
    });
    expect(answers[1]).toMatchObject({ turnId: failed.turnId, toPetId: 'ink', ok: false });
    expect(answers[1]?.text).toContain('No OpenRouter key.');
  });

  it('never offers a consulted pet the consult tool, and refuses a nested consult it invents', async () => {
    const inkBrain = brain({
      text: 'I could not ask anyone.',
      toolCall: { id: 'nested', name: ASK_PET, input: { petId: 'bolt', question: 'help?' } },
    });
    const boltBrain = brain({ text: 'ok', toolCall: askInk('Can you check with Bolt?') });

    await runnerWith({ nebius: boltBrain, openrouter: inkBrain }).run({ pet: bolt, text: 'hi' })
      .done;

    expect(inkBrain.requests[0]?.tools ?? []).toEqual([]);
    expect(inkBrain.toolResults[0]?.isError).toBe(true);
    expect(String(inkBrain.toolResults[0]?.content)).toMatch(/cannot consult/i);
    expect(boltBrain.toolResults[0]).toEqual({ content: 'I could not ask anyone.' });
  });

  it('returns an error result to the caller when the consulted pet takes too long', async () => {
    const boltBrain = brain({ text: 'I will answer alone.', toolCall: askInk('Slow question') });
    const inkBrain = brain({ text: 'one two three four five six seven eight', delayMs: 50 });

    const outcome = await runnerWith({ nebius: boltBrain, openrouter: inkBrain }, 20).run({
      pet: bolt,
      text: 'hi',
    }).done;

    expect(boltBrain.toolResults[0]?.isError).toBe(true);
    expect(String(boltBrain.toolResults[0]?.content)).toContain('did not answer within');
    expect(outcome.stopReason).toBe('end');
    expect(outcome.text).toBe('I will answer alone.');
  });

  it('returns an error result when the consulted pet’s brain fails', async () => {
    const boltBrain = brain({ text: 'ok', toolCall: askInk('q') });
    const inkBrain = brain(() => Promise.reject(new BrainError('auth', 'No OpenRouter key.')));

    await runnerWith({ nebius: boltBrain, openrouter: inkBrain }).run({ pet: bolt, text: 'hi' })
      .done;

    expect(boltBrain.toolResults[0]?.isError).toBe(true);
    expect(String(boltBrain.toolResults[0]?.content)).toContain('No OpenRouter key.');
  });

  it('refuses an unknown pet, and the caller itself, naming who can be asked', async () => {
    const boltBrain = brain({
      text: 'ok',
      toolCall: { id: 'c', name: ASK_PET, input: { petId: 'nobody', question: 'q' } },
    });
    await runnerWith({ nebius: boltBrain }).run({ pet: bolt, text: 'hi' }).done;
    expect(boltBrain.toolResults[0]?.isError).toBe(true);
    expect(String(boltBrain.toolResults[0]?.content)).toContain('ink');

    const selfBrain = brain({
      text: 'ok',
      toolCall: { id: 'd', name: ASK_PET, input: { petId: 'bolt', question: 'q' } },
    });
    await runnerWith({ nebius: selfBrain }).run({ pet: bolt, text: 'hi' }).done;
    expect(selfBrain.toolResults[0]?.isError).toBe(true);
  });

  it('is not offered when the turn opts out, as roundtable turns do', async () => {
    const boltBrain = brain({ text: 'ok' });

    await runnerWith({ nebius: boltBrain }).run({ pet: bolt, text: 'hi', allowConsult: false })
      .done;

    expect(boltBrain.requests[0]?.tools?.map((tool) => tool.name) ?? []).not.toContain(ASK_PET);
  });
});
