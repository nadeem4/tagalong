/** Tests for modelForTurn and carriesImage: which model answers a turn with a picture. */
import { describe, expect, it } from 'vitest';
import type { BrainMessage, BrainProvider } from './brain';
import { carriesImage, modelForTurn } from './vision-routing';

function provider(vision: boolean, canSee?: (model: string) => boolean): BrainProvider {
  return {
    id: 'p',
    capabilities: { vision, tools: true, streaming: true },
    listModels: () => Promise.resolve([]),
    complete: () => Promise.reject(new Error('unused')),
    ...(canSee ? { canSee } : {}),
  };
}

const seesOnly =
  (...models: string[]) =>
  (model: string) =>
    models.includes(model);

describe('modelForTurn', () => {
  it('uses the text model for a turn without an image', () => {
    const p = provider(true, seesOnly('vl'));
    expect(modelForTurn(p, { model: 'super', visionModel: 'vl' }, false)).toBe('super');
  });

  it('switches to the vision model when the turn carries an image', () => {
    const p = provider(true, seesOnly('vl'));
    expect(modelForTurn(p, { model: 'super', visionModel: 'vl' }, true)).toBe('vl');
  });

  it('keeps the text model when that model can see on its own', () => {
    const p = provider(true, seesOnly('super', 'vl'));
    expect(modelForTurn(p, { model: 'super', visionModel: 'vl' }, true)).toBe('super');
  });

  it('trusts a vision model the pet names even if the provider does not list it', () => {
    const p = provider(true, seesOnly());
    expect(modelForTurn(p, { model: 'super', visionModel: 'custom-vl' }, true)).toBe('custom-vl');
  });

  it('answers null when no model of the pet can see, so pixels are never sent', () => {
    const p = provider(true, seesOnly('vl'));
    expect(modelForTurn(p, { model: 'super' }, true)).toBeNull();
  });

  it('answers null for a provider that cannot see at all, whatever the pet names', () => {
    const p = provider(false);
    expect(modelForTurn(p, { model: 'super', visionModel: 'vl' }, true)).toBeNull();
  });

  it('treats every model of a vision provider without canSee as seeing', () => {
    const p = provider(true);
    expect(modelForTurn(p, { model: 'claude-sonnet-5', visionModel: 'x' }, true)).toBe(
      'claude-sonnet-5',
    );
  });
});

describe('carriesImage', () => {
  it('finds an image in a message', () => {
    const messages: BrainMessage[] = [
      { role: 'user', content: [{ type: 'image', mime: 'image/png', base64: 'A' }] },
    ];
    expect(carriesImage(messages)).toBe(true);
  });

  it('finds an image inside a tool result', () => {
    const messages: BrainMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 't',
            content: [{ type: 'image', mime: 'image/jpeg', base64: 'B' }],
          },
        ],
      },
    ];
    expect(carriesImage(messages)).toBe(true);
  });

  it('is false for text and text-only tool results', () => {
    const messages: BrainMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_result', toolUseId: 't', content: 'words' },
        ],
      },
    ];
    expect(carriesImage(messages)).toBe(false);
  });
});
