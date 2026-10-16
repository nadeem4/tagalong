/** Tests for OpenAiCompatibleProvider: streaming, tools, errors, vision and the model list. */
import { describe, expect, it } from 'vitest';
import type { BrainEvents, BrainRequest } from './brain';
import { BrainError } from './errors';
import { NEBIUS_BASE_URL, OpenAiCompatibleProvider } from './openai-compatible';
import { REFUSAL_MESSAGE } from './brain';

/**
 * Every test talks to a fake `fetch` that answers with canned server-sent events, so the
 * real SDK parses a real HTTP stream and nothing ever leaves the process.
 */
interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: any;
}

type Reply = Response | ((init: RequestInit) => Response);

function sse(chunks: readonly unknown[], { done = true } = {}): Response {
  const text =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
    (done ? 'data: [DONE]\n\n' : '');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(replies: Reply[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return typeof next === 'function' ? next(init) : next;
  };
  return { fetch: impl as typeof fetch, calls };
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
  return {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function usageChunk(prompt: number, completion: number): unknown {
  return {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
}

function textReply(parts: string[], finishReason = 'stop', usage: [number, number] = [11, 7]) {
  return sse([
    chunk({ role: 'assistant', content: '' }),
    ...parts.map((part) => chunk({ content: part })),
    chunk({}, finishReason),
    usageChunk(...usage),
  ]);
}

const request: BrainRequest = {
  model: 'nvidia/nemotron-3-super-120b-a12b',
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

function provider(replies: Reply[]) {
  const fake = fakeFetch(replies);
  const p = new OpenAiCompatibleProvider({
    id: 'nebius',
    apiKey: 'test-key',
    fetch: fake.fetch,
    maxRetries: 0,
  });
  return { provider: p, calls: fake.calls };
}

const signal = () => new AbortController().signal;

describe('OpenAiCompatibleProvider', () => {
  it('defaults to the Token Factory base URL and sends the key as a bearer token', async () => {
    const { provider: p, calls } = provider([textReply(['ok'])]);

    await p.complete(request, recorder().events, signal());

    expect(NEBIUS_BASE_URL).toBe('https://api.tokenfactory.nebius.com/v1/');
    expect(calls[0]?.url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-key');
  });

  it('honours a configured base URL', async () => {
    const fake = fakeFetch([textReply(['ok'])]);
    const p = new OpenAiCompatibleProvider({
      id: 'nebius',
      apiKey: 'k',
      baseURL: 'http://127.0.0.1:9999/v1/',
      fetch: fake.fetch,
      maxRetries: 0,
    });

    await p.complete(request, recorder().events, signal());

    expect(fake.calls[0]?.url).toBe('http://127.0.0.1:9999/v1/chat/completions');
  });

  it('advertises itself and its capabilities', () => {
    const { provider: p } = provider([]);
    expect(p.id).toBe('nebius');
    expect(p.capabilities).toEqual({ vision: true, tools: true });
  });

  it('streams text deltas and reports usage', async () => {
    const { provider: p, calls } = provider([textReply(['a ', 'screenshot'])]);
    const { events, deltas } = recorder();

    const result = await p.complete(request, events, signal());

    expect(deltas).toEqual(['a ', 'screenshot']);
    expect(result).toEqual({
      text: 'a screenshot',
      stopReason: 'end',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(calls[0]?.body).toMatchObject({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      max_tokens: 2048,
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('sends the system prompt as the first message and plain text as a string', async () => {
    const { provider: p, calls } = provider([textReply(['ok'])]);

    await p.complete(request, recorder().events, signal());

    expect(calls[0]?.body.messages).toEqual([
      { role: 'system', content: 'You are Scout.' },
      { role: 'user', content: 'what is this?' },
    ]);
  });

  it('ignores reasoning deltas so thinking never reaches the bubble', async () => {
    const { provider: p } = provider([
      sse([chunk({ reasoning_content: 'hmm' }), chunk({ content: 'answer' }), chunk({}, 'stop')]),
    ]);
    const { events, deltas } = recorder();

    const result = await p.complete(request, events, signal());

    expect(deltas).toEqual(['answer']);
    expect(result.text).toBe('answer');
  });

  it('sends images as data URLs, ahead of the text that asks about them', async () => {
    const { provider: p, calls } = provider([textReply(['ok'])]);

    await p.complete(
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
      signal(),
    );

    expect(calls[0]?.body.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        { type: 'text', text: 'what is on screen?' },
      ],
    });
  });

  it('translates tools into function definitions', async () => {
    const { provider: p, calls } = provider([textReply(['ok'])]);
    const tools = [
      { name: 'search', description: 'find things', inputSchema: { type: 'object' as const } },
    ];

    await p.complete({ ...request, tools }, recorder().events, signal());

    expect(calls[0]?.body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'search', description: 'find things', parameters: { type: 'object' } },
      },
    ]);
  });

  it('assembles streamed tool calls, runs them, and sends each result back', async () => {
    const { provider: p, calls } = provider([
      sse([
        chunk({ role: 'assistant', content: 'checking' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '' },
            },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }),
        chunk({
          tool_calls: [
            {
              index: 1,
              id: 'call_2',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"b"}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
        usageChunk(10, 4),
      ]),
      textReply([' all done'], 'stop', [20, 3]),
    ]);
    const { events, deltas, calls: toolCalls } = recorder();

    const result = await p.complete(request, events, signal());

    expect(toolCalls).toEqual([
      { id: 'call_1', name: 'search', input: { q: 'a' } },
      { id: 'call_2', name: 'lookup', input: { q: 'b' } },
    ]);
    const second = calls[1]?.body.messages;
    expect(second.slice(2)).toEqual([
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"a"}' } },
          { id: 'call_2', type: 'function', function: { name: 'lookup', arguments: '{"q":"b"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'result for search' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result for lookup' },
    ]);
    expect(deltas.join('')).toBe('checking all done');
    expect(result.stopReason).toBe('end');
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 7 });
  });

  it('runs tool calls even when a server reports stop instead of tool_calls', async () => {
    const { provider: p } = provider([
      sse([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'stop'),
      ]),
      textReply(['done']),
    ]);
    const { events, calls } = recorder();

    await p.complete(request, events, signal());

    expect(calls).toEqual([{ id: 'call_1', name: 'search', input: {} }]);
  });

  it('hands the tool unparseable arguments as the raw string rather than failing the turn', async () => {
    const { provider: p } = provider([
      sse([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{oops' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
      textReply(['done']),
    ]);
    const { events, calls } = recorder();

    await p.complete(request, events, signal());

    expect(calls).toEqual([{ id: 'call_1', name: 'search', input: '{oops' }]);
  });

  it('marks an error tool result so the model knows the tool failed', async () => {
    const { provider: p, calls } = provider([
      sse([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
      textReply(['sorry']),
    ]);
    const { events } = recorder();
    events.onToolUse = () => Promise.resolve({ content: 'host offline', isError: true });

    await p.complete(request, events, signal());

    expect(calls[1]?.body.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'Error: host offline',
    });
  });

  it('sends an image from a tool result as a user message right after the tool messages', async () => {
    const { provider: p, calls } = provider([
      sse([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'look_closer', arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
      textReply(['a budget']),
    ]);
    const { events } = recorder();
    events.onToolUse = () =>
      Promise.resolve({
        content: [
          { type: 'text' as const, text: 'Crop of notepad.exe.' },
          { type: 'image' as const, mime: 'image/png' as const, base64: 'AAA' },
        ],
      });

    await p.complete(request, events, signal());

    // Chat-completions tool messages are text-only, so the pixels ride in a user message.
    expect(calls[1]?.body.messages.slice(3)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content:
          'Crop of notepad.exe.\n[The tool returned 1 image; it follows in the next message.]',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
          { type: 'text', text: 'The image above was returned by the look_closer tool call.' },
        ],
      },
    ]);
  });

  it('replays tool use and image-carrying tool results out of history', async () => {
    const { provider: p, calls } = provider([textReply(['ok'])]);

    await p.complete(
      {
        ...request,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'look' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tu_9', name: 'look_at_screen', input: {} }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'tu_9',
                content: [{ type: 'image', mime: 'image/jpeg', base64: 'BBB' }],
              },
              { type: 'text', text: 'and now?' },
            ],
          },
        ],
      },
      recorder().events,
      signal(),
    );

    expect(calls[0]?.body.messages.slice(1)).toEqual([
      { role: 'user', content: 'look' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu_9', type: 'function', function: { name: 'look_at_screen', arguments: '{}' } },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tu_9',
        content: '[The tool returned 1 image; it follows in the next message.]',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' } },
          { type: 'text', text: 'The image above was returned by the look_at_screen tool call.' },
        ],
      },
      { role: 'user', content: 'and now?' },
    ]);
  });

  it('maps length to max_tokens', async () => {
    const { provider: p } = provider([textReply(['cut off'], 'length')]);
    const result = await p.complete(request, recorder().events, signal());
    expect(result.stopReason).toBe('max_tokens');
  });

  it('maps content_filter to a refusal with a friendly message', async () => {
    const { provider: p } = provider([textReply([], 'content_filter')]);
    const { events, deltas } = recorder();

    const result = await p.complete(request, events, signal());

    expect(result.stopReason).toBe('refusal');
    expect(result.text).toBe(REFUSAL_MESSAGE);
    expect(deltas).toEqual([REFUSAL_MESSAGE]);
  });

  it('treats a stream without usage as zero tokens rather than failing', async () => {
    const { provider: p } = provider([sse([chunk({ content: 'hi' }), chunk({}, 'stop')])]);
    const result = await p.complete(request, recorder().events, signal());
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it.each([
    [429, 'rate_limit'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'config'],
    [500, 'unknown'],
  ])('maps HTTP %i to a readable BrainError', async (status, code) => {
    const { provider: p } = provider([jsonError(status, 'nope')]);

    const failure = p.complete(request, recorder().events, signal());

    await expect(failure).rejects.toBeInstanceOf(BrainError);
    await failure.catch((error: BrainError) => {
      expect(error.code).toBe(code);
      expect(error.message).toContain('Token Factory');
    });
  });

  it('names the model when the server does not know it', async () => {
    const { provider: p } = provider([jsonError(404, 'model not found')]);
    await expect(p.complete(request, recorder().events, signal())).rejects.toThrow(
      'nvidia/nemotron-3-super-120b-a12b',
    );
  });

  it('maps a network failure to a connection error', async () => {
    const { provider: p } = provider([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    await expect(p.complete(request, recorder().events, signal())).rejects.toMatchObject({
      code: 'connection',
    });
  });

  it('returns aborted without a request when the signal is already aborted', async () => {
    const { provider: p, calls } = provider([]);
    const controller = new AbortController();
    controller.abort();

    const result = await p.complete(request, recorder().events, controller.signal);

    expect(result.stopReason).toBe('aborted');
    expect(calls).toHaveLength(0);
  });

  it('stops mid-stream with what it had when the caller interrupts', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const hanging = (init: RequestInit): Response => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: 'half' }))}\n\n`));
          init.signal?.addEventListener('abort', () =>
            stream.error(new DOMException('The operation was aborted.', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const { provider: p } = provider([hanging]);
    const { events, deltas } = recorder();
    events.onText = (delta) => {
      deltas.push(delta);
      controller.abort();
    };

    const result = await p.complete(request, events, controller.signal);

    expect(deltas).toEqual(['half']);
    expect(result.text).toBe('half');
    expect(result.stopReason).toBe('aborted');
  });
});

describe('OpenAiCompatibleProvider vision routing', () => {
  function routed(replies: Reply[]) {
    const fake = fakeFetch(replies);
    const p = new OpenAiCompatibleProvider({
      id: 'nebius',
      apiKey: 'k',
      fetch: fake.fetch,
      maxRetries: 0,
      visionModels: ['vl'],
    });
    return { provider: p, calls: fake.calls };
  }

  const withScreenshot: BrainRequest = {
    ...request,
    model: 'super',
    visionModel: 'vl',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mime: 'image/png', base64: 'AAA' },
          { type: 'text', text: 'what is this?' },
        ],
      },
    ],
  };

  it('reports which models can see', () => {
    const { provider: p } = routed([]);
    expect(p.canSee('vl')).toBe(true);
    expect(p.canSee('super')).toBe(false);
  });

  it('answers a text-only turn on the text model', async () => {
    const { provider: p, calls } = routed([textReply(['ok'])]);
    await p.complete(
      { ...request, model: 'super', visionModel: 'vl' },
      recorder().events,
      signal(),
    );
    expect(calls[0]?.body.model).toBe('super');
  });

  it('answers a turn that carries a screenshot on the vision model', async () => {
    const { provider: p, calls } = routed([textReply(['ok'])]);
    await p.complete(withScreenshot, recorder().events, signal());
    expect(calls[0]?.body.model).toBe('vl');
  });

  it('switches to the vision model once a tool hands back an image', async () => {
    const { provider: p, calls } = routed([
      sse([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              type: 'function',
              function: { name: 'look_closer', arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
      textReply(['a chart']),
    ]);
    const { events } = recorder();
    events.onToolUse = () =>
      Promise.resolve({
        content: [{ type: 'image' as const, mime: 'image/png' as const, base64: 'C' }],
      });

    await p.complete({ ...request, model: 'super', visionModel: 'vl' }, events, signal());

    expect(calls.map((call) => call.body.model)).toEqual(['super', 'vl']);
  });

  it('never sends pixels to a model that cannot see them', async () => {
    const { provider: p, calls } = routed([textReply(['ok'])]);
    const { visionModel: _none, ...noVision } = withScreenshot;

    await p.complete(noVision, recorder().events, signal());

    expect(calls[0]?.body.model).toBe('super');
    expect(JSON.stringify(calls[0]?.body.messages)).not.toContain('image_url');
    expect(calls[0]?.body.messages[1]).toEqual({
      role: 'user',
      content: '[An image was attached, but super cannot see images.]\nwhat is this?',
    });
  });
});

describe('OpenAiCompatibleProvider models', () => {
  function models(replies: Reply[]) {
    const fake = fakeFetch(replies);
    const p = new OpenAiCompatibleProvider({
      id: 'openrouter',
      apiKey: 'k',
      baseURL: 'https://openrouter.ai/api/v1',
      fetch: fake.fetch,
      maxRetries: 0,
      models: ['fallback-model'],
    });
    return { provider: p, calls: fake.calls };
  }

  it('lists its fallback models without touching the network', async () => {
    const { provider: p, calls } = models([]);
    expect(await p.listModels()).toEqual(['fallback-model']);
    expect(calls).toHaveLength(0);
  });

  it('fetches the live list from GET /models', async () => {
    const { provider: p, calls } = models([
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'b-model', object: 'model', created: 0, owned_by: 'x' },
            { id: 'a-model', object: 'model', created: 0, owned_by: 'x' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ]);

    expect(await p.fetchModels()).toEqual(['a-model', 'b-model']);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/models');
    expect(calls[0]?.method).toBe('GET');
  });

  it('reports a failed live list as a BrainError naming the service', async () => {
    const { provider: p } = models([jsonError(401, 'bad key')]);
    await expect(p.fetchModels()).rejects.toMatchObject({ code: 'auth' });
  });

  it('blames the base URL, not a model, when GET /models is a 404', async () => {
    const { provider: p } = models([jsonError(404, 'nope')]);
    await expect(p.fetchModels()).rejects.toThrow('Check the base URL');
  });

  it('streams through the comment lines OpenRouter sends while it waits', async () => {
    const body =
      ': OPENROUTER PROCESSING\n\n' +
      `data: ${JSON.stringify(chunk({ content: 'hi' }))}\n\n` +
      `data: ${JSON.stringify(chunk({}, 'stop'))}\n\n` +
      'data: [DONE]\n\n';
    const { provider: p } = models([
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ]);
    const result = await p.complete(request, recorder().events, signal());
    expect(result.text).toBe('hi');
  });
});
