/** Tests for AnthropicProvider: streaming, caching, image order, the tool loop and refusals. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrainEvents, BrainRequest } from './brain';
import { BrainError } from './errors';
import { AnthropicProvider, REFUSAL_MESSAGE } from './anthropic';

/**
 * The SDK is mocked wholesale: these tests must never open a socket, and the error
 * classes have to be the same objects the provider does `instanceof` against.
 */
const sdk = vi.hoisted(() => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class APIConnectionError extends APIError {}
  class APIUserAbortError extends APIError {}
  return {
    stream: vi.fn(),
    constructed: [] as unknown[],
    APIError,
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    APIUserAbortError,
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { stream: sdk.stream };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  },
  APIError: sdk.APIError,
  RateLimitError: sdk.RateLimitError,
  AuthenticationError: sdk.AuthenticationError,
  APIConnectionError: sdk.APIConnectionError,
  APIUserAbortError: sdk.APIUserAbortError,
}));

type FakeMessage = {
  content: any[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
};

/** A stand-in for the SDK's MessageStream: replays deltas, then resolves the message. */
function streamOf(message: FakeMessage, deltas: string[] = []): unknown {
  const handlers = new Map<string, (...args: any[]) => void>();
  const stream = {
    on(event: string, handler: (...args: any[]) => void) {
      handlers.set(event, handler);
      return stream;
    },
    async finalMessage() {
      for (const delta of deltas) handlers.get('text')?.(delta, delta);
      return message;
    },
  };
  return stream;
}

function failingStream(error: Error): unknown {
  const stream = {
    on() {
      return stream;
    },
    finalMessage: () => Promise.reject(error),
  };
  return stream;
}

function textMessage(text: string, stopReason = 'end_turn'): FakeMessage {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 11, output_tokens: 7 },
  };
}

const request: BrainRequest = {
  model: 'claude-opus-5',
  system: 'You are Scout.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this?' }] }],
  maxTokens: 2048,
};

function recorder(): { events: BrainEvents; deltas: string[]; calls: unknown[] } {
  const deltas: string[] = [];
  const calls: unknown[] = [];
  return {
    deltas,
    calls,
    events: {
      onText: (delta) => {
        deltas.push(delta);
      },
      onToolUse: async (call) => {
        calls.push(call);
        return { content: `result for ${call.name}` };
      },
    },
  };
}

function provider(): AnthropicProvider {
  return new AnthropicProvider({ apiKey: 'test-key' });
}

beforeEach(() => {
  sdk.stream.mockReset();
  sdk.constructed.length = 0;
});

describe('AnthropicProvider', () => {
  it('advertises itself and its models without touching the network', async () => {
    const p = provider();
    expect(p.id).toBe('anthropic');
    expect(p.capabilities).toEqual({ vision: true, tools: true, streaming: true });
    expect(await p.listModels()).toContain('claude-opus-5');
    expect(sdk.stream).not.toHaveBeenCalled();
  });

  it('streams text and reports usage', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('a screenshot'), ['a ', 'screenshot']));
    const { events, deltas } = recorder();

    const result = await provider().complete(request, events, new AbortController().signal);

    expect(deltas).toEqual(['a ', 'screenshot']);
    expect(result.text).toBe('a screenshot');
    expect(result.stopReason).toBe('end');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('asks for adaptive thinking and never sends budget_tokens or temperature', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('ok')));

    await provider().complete(request, recorder().events, new AbortController().signal);

    const [body] = sdk.stream.mock.calls[0] as [any, any];
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body).not.toHaveProperty('temperature');
    expect(body.thinking).not.toHaveProperty('budget_tokens');
    expect(body.model).toBe('claude-opus-5');
    expect(body.max_tokens).toBe(2048);
  });

  it('puts the system prompt and tools in a cached system block', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('ok')));
    const tools = [
      { name: 'search', description: 'find things', inputSchema: { type: 'object' as const } },
    ];

    await provider().complete(
      { ...request, tools },
      recorder().events,
      new AbortController().signal,
    );

    const [body] = sdk.stream.mock.calls[0] as [any, any];
    expect(body.system).toEqual([
      { type: 'text', text: 'You are Scout.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.tools).toEqual([
      { name: 'search', description: 'find things', input_schema: { type: 'object' } },
    ]);
  });

  it('places image blocks before the text block of a message', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('ok')));

    await provider().complete(
      {
        ...request,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is on screen?' },
              { type: 'image', mime: 'image/png', base64: 'AAA' },
            ],
          },
        ],
      },
      recorder().events,
      new AbortController().signal,
    );

    const [body] = sdk.stream.mock.calls[0] as [any, any];
    expect(body.messages[0].content.map((block: any) => block.type)).toEqual(['image', 'text']);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
    });
  });

  it('runs the tool loop and sends every result back in one user message', async () => {
    const toolTurn: FakeMessage = {
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'a' } },
        { type: 'tool_use', id: 'tu_2', name: 'lookup', input: { q: 'b' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 4 },
    };
    sdk.stream
      .mockReturnValueOnce(streamOf(toolTurn, ['checking']))
      .mockReturnValueOnce(streamOf(textMessage('all done'), [' all done']));
    const { events, deltas, calls } = recorder();

    const result = await provider().complete(request, events, new AbortController().signal);

    expect(calls).toEqual([
      { id: 'tu_1', name: 'search', input: { q: 'a' } },
      { id: 'tu_2', name: 'lookup', input: { q: 'b' } },
    ]);
    const [secondBody] = sdk.stream.mock.calls[1] as [any, any];
    expect(secondBody.messages).toHaveLength(3);
    expect(secondBody.messages[1]).toEqual({ role: 'assistant', content: toolTurn.content });
    expect(secondBody.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'result for search' },
        { type: 'tool_result', tool_use_id: 'tu_2', content: 'result for lookup' },
      ],
    });
    expect(deltas.join('')).toBe('checking all done');
    expect(result.stopReason).toBe('end');
    expect(result.usage).toEqual({ inputTokens: 21, outputTokens: 11 });
  });

  it('sends an image-carrying tool result back as tool_result content blocks', async () => {
    const toolTurn: FakeMessage = {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'look_at_screen', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 4 },
    };
    sdk.stream
      .mockReturnValueOnce(streamOf(toolTurn))
      .mockReturnValueOnce(streamOf(textMessage('a budget')));
    const { events } = recorder();
    events.onToolUse = () =>
      Promise.resolve({
        content: [
          { type: 'text' as const, text: 'Screenshot of notepad.exe.' },
          { type: 'image' as const, mime: 'image/png' as const, base64: 'AAA' },
        ],
      });

    await provider().complete(request, events, new AbortController().signal);

    const [secondBody] = sdk.stream.mock.calls[1] as [any, any];
    expect(secondBody.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu_1',
      // Image first here too: the picture has to arrive before the words about it.
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        { type: 'text', text: 'Screenshot of notepad.exe.' },
      ],
    });
  });

  it('replays an image-carrying tool result out of history unchanged', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('ok')));

    await provider().complete(
      {
        ...request,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'tu_9',
                content: [{ type: 'image', mime: 'image/png', base64: 'BBB' }],
              },
            ],
          },
        ],
      },
      recorder().events,
      new AbortController().signal,
    );

    const [body] = sdk.stream.mock.calls[0] as [any, any];
    expect(body.messages[0].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu_9',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBB' } },
      ],
    });
  });

  it('surfaces a friendly message when the model refuses', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('', 'refusal')));
    const { events, deltas } = recorder();

    const result = await provider().complete(request, events, new AbortController().signal);

    expect(result.stopReason).toBe('refusal');
    expect(result.text).toBe(REFUSAL_MESSAGE);
    expect(deltas).toEqual([REFUSAL_MESSAGE]);
  });

  it('reports the max_tokens stop reason', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('cut off', 'max_tokens'), ['cut off']));

    const result = await provider().complete(
      request,
      recorder().events,
      new AbortController().signal,
    );

    expect(result.stopReason).toBe('max_tokens');
  });

  it.each([
    ['RateLimitError', () => new sdk.RateLimitError('429'), 'rate_limit'],
    ['AuthenticationError', () => new sdk.AuthenticationError('401'), 'auth'],
    ['APIConnectionError', () => new sdk.APIConnectionError('offline'), 'connection'],
    ['an unknown error', () => new Error('boom'), 'unknown'],
  ])('maps %s to a readable BrainError', async (_name, makeError, code) => {
    sdk.stream.mockReturnValue(failingStream(makeError()));

    const failure = provider().complete(request, recorder().events, new AbortController().signal);

    await expect(failure).rejects.toBeInstanceOf(BrainError);
    await failure.catch((error: BrainError) => {
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(10);
    });
  });

  it('stops with the aborted stop reason when the caller interrupts', async () => {
    sdk.stream.mockReturnValue(failingStream(new sdk.APIUserAbortError('aborted')));

    const result = await provider().complete(
      request,
      recorder().events,
      new AbortController().signal,
    );

    expect(result.stopReason).toBe('aborted');
  });

  it('passes the abort signal down to the SDK', async () => {
    sdk.stream.mockReturnValue(streamOf(textMessage('ok')));
    const controller = new AbortController();

    await provider().complete(request, recorder().events, controller.signal);

    const [, options] = sdk.stream.mock.calls[0] as [any, any];
    expect(options.signal).toBe(controller.signal);
  });
});
