import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, Message, Pet, Settings } from '@tagalong/protocol';
import { Settings as SettingsSchema } from '@tagalong/protocol';
import {
  CONTEXT_LABELS,
  MAX_SELECTION_CHARS,
  TRUNCATION_MARKER,
  assemblePrompt,
} from './prompt-assembler';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  persona: 'You are Scout, a terse field guide.',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  toolAllowlist: [],
  replyStyle: 'text',
};

const settings: Settings = SettingsSchema.parse({});

function userMessage(text: string): Message {
  return {
    id: randomUUID(),
    conversationId: conversationId,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  };
}

function assistantMessage(text: string): Message {
  return { ...userMessage(text), role: 'assistant' };
}

const conversationId = randomUUID();

function snapshotWithEverything(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'extension',
    app: { name: 'chrome.exe', windowTitle: 'Zod docs - Chrome' },
    selection: 'the highlighted paragraph',
    page: { url: 'https://zod.dev/', title: 'Zod', text: 'page body text' },
    screenshot: { mime: 'image/png', base64: 'aGk=', width: 800, height: 600 },
    ...overrides,
  };
}

function lastText(request: ReturnType<typeof assemblePrompt>): string {
  const message = request.messages.at(-1);
  return (message?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

describe('assemblePrompt system prompt', () => {
  it('states the base rules, the persona, and the reply style', () => {
    const { system } = assemblePrompt({ pet, history: [userMessage('hi')], settings });

    expect(system).toContain('screen');
    expect(system.toLowerCase()).toContain('concise');
    expect(system).toMatch(/never claim/i);
    expect(system).toMatch(/clicked|typed/i);
    expect(system).toContain(pet.persona);
  });

  it('swaps in the reply-style rule the pet asked for', () => {
    const spoken = assemblePrompt({
      pet: { ...pet, replyStyle: 'voice-full' },
      history: [userMessage('hi')],
      settings,
    });
    expect(spoken.system).toMatch(/spoken|aloud/i);
    expect(spoken.system).not.toBe(
      assemblePrompt({ pet, history: [userMessage('hi')], settings }).system,
    );
  });
});

describe('assemblePrompt context block', () => {
  it('orders the sections selection, page, window, screenshot', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is this?')],
      snapshot: snapshotWithEverything(),
      settings,
    });
    const text = lastText(request);

    const order = [
      text.indexOf(CONTEXT_LABELS.selection),
      text.indexOf(CONTEXT_LABELS.page),
      text.indexOf(CONTEXT_LABELS.window),
      text.indexOf(CONTEXT_LABELS.screenshot),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps the user question ahead of the context it was asked about', () => {
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('what is this?')],
        snapshot: snapshotWithEverything(),
        settings,
      }),
    );
    expect(text.indexOf('what is this?')).toBeLessThan(text.indexOf(CONTEXT_LABELS.selection));
  });

  it('truncates page text at the settings budget and says so', () => {
    const budget = 100;
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('summarise')],
        snapshot: snapshotWithEverything({
          page: { url: 'https://zod.dev/', title: 'Zod', text: 'p'.repeat(budget + 500) },
        }),
        settings: { ...settings, pageTextBudget: budget },
      }),
    );

    expect(text).toContain(`${'p'.repeat(budget)}${TRUNCATION_MARKER}`);
    expect(text).not.toContain('p'.repeat(budget + 1));
  });

  it('keeps a selection whole up to the selection ceiling', () => {
    const selection = 's'.repeat(MAX_SELECTION_CHARS);
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('explain this')],
        snapshot: snapshotWithEverything({ selection, page: undefined }),
        settings: { ...settings, pageTextBudget: 10 },
      }),
    );

    expect(text).toContain(selection);
    expect(text).not.toContain(TRUNCATION_MARKER);
  });

  it('skips sections the snapshot does not carry', () => {
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('hello')],
        snapshot: {
          id: randomUUID(),
          capturedAt: new Date().toISOString(),
          host: 'desktop',
          selection: 'just this',
        },
        settings,
      }),
    );

    expect(text).toContain(CONTEXT_LABELS.selection);
    expect(text).not.toContain(CONTEXT_LABELS.page);
    expect(text).not.toContain(CONTEXT_LABELS.window);
    expect(text).not.toContain(CONTEXT_LABELS.screenshot);
  });

  it('leaves the message untouched when there is no snapshot', () => {
    const request = assemblePrompt({ pet, history: [userMessage('hello')], settings });
    expect(request.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'hello' }]);
  });
});

describe('assemblePrompt messages', () => {
  it('emits the screenshot as an image content block', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is this?')],
      snapshot: snapshotWithEverything(),
      settings,
    });

    expect(request.messages.at(-1)?.content.at(-1)).toEqual({
      type: 'image',
      mime: 'image/png',
      base64: 'aGk=',
    });
  });

  it('replays history in order and keeps roles', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('first'), assistantMessage('answer'), userMessage('second')],
      settings,
    });

    expect(request.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(request.messages[0]?.content).toEqual([{ type: 'text', text: 'first' }]);
  });

  it('keeps only the last historyMessages entries', () => {
    const history = Array.from({ length: 8 }, (_, index) => userMessage(`m${index}`));
    const request = assemblePrompt({
      pet,
      history,
      settings: { ...settings, historyMessages: 3 },
    });

    expect(request.messages).toHaveLength(3);
    expect(lastText(request)).toContain('m7');
  });

  it('asks the model the pet is configured with', () => {
    const request = assemblePrompt({ pet, history: [userMessage('hi')], settings });
    expect(request.model).toBe('claude-opus-5');
    expect(request.maxTokens).toBeGreaterThan(0);
  });

  it('adds a user message when the context has nowhere else to go', () => {
    const request = assemblePrompt({
      pet,
      history: [assistantMessage('still thinking')],
      snapshot: snapshotWithEverything({ screenshot: undefined }),
      settings,
    });

    expect(request.messages.at(-1)?.role).toBe('user');
    expect(lastText(request)).toContain(CONTEXT_LABELS.selection);
  });
});
