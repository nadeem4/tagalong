import { describe, expect, it } from 'vitest';
import {
  coreToHostMethods,
  coreToHostNotifications,
  hostToCoreMethods,
  notificationParamsSchemaFor,
  paramsSchemaFor,
  resultSchemaFor,
} from './methods';

/** Every row of the Phase 1 method table, by direction. */
const HOST_TO_CORE = [
  'hello',
  'ask',
  'interrupt',
  'pets.list',
  'pets.upsert',
  'pets.delete',
  'settings.get',
  'settings.set',
  'tool.approve',
] as const;

const CORE_TO_HOST = ['perception.capture'] as const;

const CORE_TO_HOST_NOTIFICATIONS = [
  'turn.started',
  'turn.delta',
  'turn.audio',
  'turn.toolRequest',
  'turn.toolResult',
  'turn.completed',
  'turn.error',
  'turn.warning',
  'pet.message',
] as const;

describe('method catalog', () => {
  it.each(HOST_TO_CORE)('host-to-core %s has params and result schemas', (method) => {
    expect(hostToCoreMethods[method].params).toBeDefined();
    expect(hostToCoreMethods[method].result).toBeDefined();
  });

  it.each(CORE_TO_HOST)('core-to-host %s has params and result schemas', (method) => {
    expect(coreToHostMethods[method].params).toBeDefined();
    expect(coreToHostMethods[method].result).toBeDefined();
  });

  it.each(CORE_TO_HOST_NOTIFICATIONS)('notification %s has a params schema', (method) => {
    expect(coreToHostNotifications[method].params).toBeDefined();
  });

  it('covers the table exactly, with no extra methods', () => {
    expect(Object.keys(hostToCoreMethods).sort()).toEqual([...HOST_TO_CORE].sort());
    expect(Object.keys(coreToHostNotifications).sort()).toEqual(
      [...CORE_TO_HOST_NOTIFICATIONS].sort(),
    );
  });
});

describe('schema lookup helpers', () => {
  it('validates hello params through the catalog', () => {
    const parsed = paramsSchemaFor('hello').parse({
      host: 'desktop',
      version: '0.0.0',
      capabilities: ['selection', 'activeWindow'],
      token: 'abc123',
    });
    expect(parsed.host).toBe('desktop');
  });

  it('rejects hello params missing the pairing token', () => {
    const bad = { host: 'desktop', version: '0.0.0', capabilities: [] };
    expect(paramsSchemaFor('hello').safeParse(bad).success).toBe(false);
  });

  it('validates an ask result through the catalog', () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    expect(resultSchemaFor('ask').parse({ turnId }).turnId).toBe(turnId);
  });

  it('rejects an unknown host capability', () => {
    const bad = { host: 'desktop', version: '0.0.0', capabilities: ['mind-reading'], token: 'x' };
    expect(paramsSchemaFor('hello').safeParse(bad).success).toBe(false);
  });
});

describe('ask input', () => {
  const turnId = '11111111-2222-4333-8444-555555555555';

  it('accepts a text-only ask', () => {
    const parsed = paramsSchemaFor('ask').parse({
      petId: 'scout',
      input: { text: 'explain this' },
    });
    expect(parsed.petId).toBe('scout');
  });

  it('accepts an audio-only ask', () => {
    const params = { petId: 'scout', input: { audio: { mime: 'audio/webm', base64: 'aGk=' } } };
    expect(paramsSchemaFor('ask').safeParse(params).success).toBe(true);
  });

  it('rejects an ask with neither text nor audio', () => {
    expect(paramsSchemaFor('ask').safeParse({ petId: 'scout', input: {} }).success).toBe(false);
  });

  it('rejects an ask with no pet', () => {
    expect(paramsSchemaFor('ask').safeParse({ input: { text: 'hi' } }).success).toBe(false);
  });

  it('rejects a non-uuid conversation id', () => {
    const params = { petId: 'scout', conversationId: 'nope', input: { text: 'hi' } };
    expect(paramsSchemaFor('ask').safeParse(params).success).toBe(false);
  });

  it('rejects a non-uuid turn id in the interrupt result path', () => {
    expect(paramsSchemaFor('interrupt').safeParse({ turnId: 'nope' }).success).toBe(false);
    expect(paramsSchemaFor('interrupt').safeParse({ turnId }).success).toBe(true);
  });
});

describe('notification schemas', () => {
  const turnId = '11111111-2222-4333-8444-555555555555';

  it('validates a turn.delta payload', () => {
    const parsed = notificationParamsSchemaFor('turn.delta').parse({ turnId, text: 'hello' });
    expect(parsed.text).toBe('hello');
  });

  it('validates a turn.completed payload', () => {
    const parsed = notificationParamsSchemaFor('turn.completed').parse({
      turnId,
      text: 'done',
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(parsed.stopReason).toBe('end');
  });

  it('rejects an unknown stop reason', () => {
    const bad = {
      turnId,
      text: '',
      stopReason: 'bored',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    expect(notificationParamsSchemaFor('turn.completed').safeParse(bad).success).toBe(false);
  });

  it('rejects negative token usage', () => {
    const bad = {
      turnId,
      text: '',
      stopReason: 'end',
      usage: { inputTokens: -1, outputTokens: 0 },
    };
    expect(notificationParamsSchemaFor('turn.completed').safeParse(bad).success).toBe(false);
  });

  it('validates a turn.warning payload', () => {
    const parsed = notificationParamsSchemaFor('turn.warning').parse({
      turnId,
      code: 'vision_unsupported',
      message: 'This pet cannot see images, so the screenshot was not sent.',
    });
    expect(parsed.code).toBe('vision_unsupported');
  });

  it('rejects a turn.warning without a code, so no host has to guess why', () => {
    const bad = { turnId, message: 'something happened' };
    expect(notificationParamsSchemaFor('turn.warning').safeParse(bad).success).toBe(false);
  });

  it('validates a pet.message handoff payload', () => {
    const parsed = notificationParamsSchemaFor('pet.message').parse({
      fromPetId: 'scout',
      toPetId: 'ink',
      kind: 'handoff',
      text: 'over to you',
    });
    expect(parsed.kind).toBe('handoff');
  });

  it('rejects an unknown pet.message kind', () => {
    const bad = { fromPetId: 'a', toPetId: 'b', kind: 'gossip', text: '' };
    expect(notificationParamsSchemaFor('pet.message').safeParse(bad).success).toBe(false);
  });
});

describe('perception.capture', () => {
  it('accepts a list of capture targets', () => {
    const parsed = coreToHostMethods['perception.capture'].params.parse({
      what: ['selection', 'activeWindow'],
    });
    expect(parsed.what).toEqual(['selection', 'activeWindow']);
  });

  it('rejects an empty capture request', () => {
    expect(coreToHostMethods['perception.capture'].params.safeParse({ what: [] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown capture target', () => {
    const bad = { what: ['aura'] };
    expect(coreToHostMethods['perception.capture'].params.safeParse(bad).success).toBe(false);
  });

  it('returns a partial snapshot', () => {
    const parsed = coreToHostMethods['perception.capture'].result.parse({
      snapshot: { selection: 'just the selection' },
    });
    expect(parsed.snapshot.selection).toBe('just the selection');
  });
});
