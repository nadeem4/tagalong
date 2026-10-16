/**
 * A provider over the OpenAI chat-completions wire format, used for OpenRouter and any other
 * chat-completions server. Contains `OpenAiCompatibleProvider`. Handles pictures, tool calls,
 * refusals, and the live model list (`fetchModels`).
 */
import OpenAI, {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import type {
  ChatCompletionContentPart,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { REFUSAL_MESSAGE } from './brain';
import type {
  BrainCapabilities,
  BrainContentBlock,
  BrainEvents,
  BrainMessage,
  BrainProvider,
  BrainRequest,
  BrainResult,
  BrainTool,
} from './brain';
import { BrainError } from './errors';

export interface OpenAiCompatibleProviderOptions {
  /** The registry id this instance answers to, e.g. 'openrouter'. */
  id: string;
  apiKey: string;
  /** Any chat-completions server works. */
  baseURL: string;
  /** Shown in error messages, so a person knows which service failed. */
  label: string;
  /** Injected by tests, which answer with a canned event stream instead of the network. */
  fetch?: typeof fetch | undefined;
  /** Tests pass 0 so an error case does not sit through the SDK's back-off. */
  maxRetries?: number | undefined;
}

type BlockImage = Extract<BrainContentBlock, { type: 'image' }>;

function imagePart(block: BlockImage): ChatCompletionContentPart {
  return { type: 'image_url', image_url: { url: `data:${block.mime};base64,${block.base64}` } };
}

/**
 * Plain text goes as a string, anything with a picture as parts with the pictures first.
 *
 * The string form is not cosmetic: some OpenAI-compatible servers accept content parts
 * only on vision models, so a text-only turn sent as parts can be rejected outright.
 */
function userContent(blocks: readonly BrainContentBlock[]): string | ChatCompletionContentPart[] {
  const images = blocks.filter((b): b is BlockImage => b.type === 'image');
  const texts = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
  if (images.length === 0) return texts.join('\n');
  return [
    ...images.map(imagePart),
    ...texts.map((text): ChatCompletionContentPart => ({ type: 'text', text })),
  ];
}

/**
 * One tool result, as the messages chat-completions can carry.
 *
 * A `tool` message is text-only in this wire format, so an image a tool returns cannot
 * ride inside it. It follows as a user message instead, with the tool message saying so —
 * otherwise a model reading only the tool message would think the look came back empty.
 */
function toolResultMessages(
  toolCallId: string,
  toolName: string | undefined,
  content: string | BrainContentBlock[],
  isError: boolean | undefined,
): { tool: ChatCompletionMessageParam; images: ChatCompletionContentPart[] } {
  const blocks: BrainContentBlock[] =
    typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const images = blocks.filter((b): b is BlockImage => b.type === 'image');
  const lines = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
  if (images.length > 0) {
    lines.push(
      `[The tool returned ${images.length} image${images.length === 1 ? '' : 's'}; ` +
        `${images.length === 1 ? 'it follows' : 'they follow'} in the next message.]`,
    );
  }
  const text = lines.join('\n');
  return {
    tool: {
      role: 'tool',
      tool_call_id: toolCallId,
      content: isError === true ? `Error: ${text}` : text,
    },
    images: images.length === 0 ? [] : [...images.map(imagePart), imageCaption(toolName, images)],
  };
}

function imageCaption(
  toolName: string | undefined,
  images: readonly BlockImage[],
): ChatCompletionContentPart {
  const which = images.length === 1 ? 'The image above was' : 'The images above were';
  // History trimmed to a window can start after the call, so the name may be unknown.
  const call = toolName === undefined ? 'that tool call' : `the ${toolName} tool call`;
  return { type: 'text', text: `${which} returned by ${call}.` };
}

/** Tool results first, then their pictures, so each sits right after the call it answers. */
function resultsThenImages(
  results: { tool: ChatCompletionMessageParam; images: ChatCompletionContentPart[] }[],
): ChatCompletionMessageParam[] {
  const images = results.flatMap((r) => r.images);
  return [
    ...results.map((r) => r.tool),
    ...(images.length === 0 ? [] : [{ role: 'user' as const, content: images }]),
  ];
}

/**
 * Brain history into chat-completions messages.
 *
 * Tool results live in user messages in the brain format and in `tool` messages here, so
 * a user message can split in two: its results go first (they must follow the assistant
 * turn that called them), then whatever the person actually said.
 */
function toMessages(
  system: string,
  history: readonly BrainMessage[],
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  const toolNames = new Map<string, string>();

  for (const message of history) {
    if (message.role === 'assistant') {
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const calls = message.content.flatMap((b): ChatCompletionMessageFunctionToolCall[] => {
        if (b.type !== 'tool_use') return [];
        toolNames.set(b.id, b.name);
        return [
          {
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          },
        ];
      });
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }

    const results = message.content.flatMap((b) =>
      b.type === 'tool_result'
        ? [toolResultMessages(b.toolUseId, toolNames.get(b.toolUseId), b.content, b.isError)]
        : [],
    );
    out.push(...resultsThenImages(results));

    const said = message.content.filter(
      (b): b is BrainContentBlock => b.type === 'text' || b.type === 'image',
    );
    if (said.length > 0) out.push({ role: 'user', content: userContent(said) });
  }
  return out;
}

function toTool(tool: BrainTool): ChatCompletionFunctionTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

/**
 * Arguments arrive as a JSON string the model wrote. A malformed one is handed to the tool
 * as the raw string: the tool's own validation then answers with an error the model can
 * correct, which beats killing the whole turn over a missing brace.
 */
function parseArguments(raw: string): unknown {
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * A BrainProvider over the OpenAI chat-completions wire format.
 *
 * Used for OpenRouter, but nothing in it is OpenRouter-specific beyond the base URL, so a
 * local vLLM or any other compatible server is one option away.
 */
export class OpenAiCompatibleProvider implements BrainProvider {
  readonly id: string;
  readonly capabilities: BrainCapabilities = { vision: true, tools: true };

  readonly #client: OpenAI;
  readonly #label: string;
  readonly #baseURL: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.id = options.id;
    this.#label = options.label;
    this.#baseURL = options.baseURL;
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: this.#baseURL,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    });
  }

  /**
   * The service's own list, from `GET /models`, sorted so a long list is scannable.
   * Throws a `BrainError` when the service cannot be asked; the caller falls back to the
   * preset's built-in list.
   */
  async fetchModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const model of this.#client.models.list()) ids.push(model.id);
      return ids.sort((a, b) => a.localeCompare(b));
    } catch (error) {
      throw this.#toBrainError(error);
    }
  }

  async complete(
    req: BrainRequest,
    events: BrainEvents,
    signal: AbortSignal,
  ): Promise<BrainResult> {
    const messages = toMessages(req.system, req.messages);
    const tools = req.tools?.map(toTool);
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const finish = (stopReason: BrainResult['stopReason']): BrainResult => ({
      text,
      stopReason,
      usage: { inputTokens, outputTokens },
    });

    // The loop only ever repeats for tool calls; every other finish reason returns.
    for (;;) {
      if (signal.aborted) return finish('aborted');

      let roundText = '';
      let finishReason: string | null = null;
      const pending = new Map<number, PendingCall>();

      try {
        const stream = await this.#client.chat.completions.create(
          {
            model: req.model,
            messages,
            max_tokens: req.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...(tools === undefined || tools.length === 0 ? {} : { tools }),
          },
          { signal },
        );
        for await (const chunk of stream) {
          if (chunk.usage) {
            inputTokens += chunk.usage.prompt_tokens;
            outputTokens += chunk.usage.completion_tokens;
          }
          const choice = chunk.choices[0];
          if (choice === undefined) continue;
          // Reasoning models stream their thinking in a separate field; only `content`
          // is the answer, so nothing else reaches the bubble.
          const delta = choice.delta.content;
          if (typeof delta === 'string' && delta.length > 0) {
            roundText += delta;
            text += delta;
            events.onText(delta);
          }
          for (const call of choice.delta.tool_calls ?? []) {
            const entry = pending.get(call.index) ?? { id: '', name: '', arguments: '' };
            if (call.id) entry.id = call.id;
            if (call.function?.name) entry.name += call.function.name;
            if (call.function?.arguments) entry.arguments += call.function.arguments;
            pending.set(call.index, entry);
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (error) {
        if (error instanceof APIUserAbortError || signal.aborted) return finish('aborted');
        throw this.#toBrainError(error, req.model);
      }

      // The SDK ends the iteration quietly when the signal fires mid-stream.
      if (signal.aborted) return finish('aborted');

      // Some servers report `stop` on a turn that called tools, so the calls decide.
      if (pending.size > 0) {
        const calls = [...pending.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }));
        messages.push({
          role: 'assistant',
          content: roundText.length > 0 ? roundText : null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments || '{}' },
          })),
        });
        const results = [];
        for (const call of calls) {
          const result = await events.onToolUse({
            id: call.id,
            name: call.name,
            input: parseArguments(call.arguments),
          });
          results.push(toolResultMessages(call.id, call.name, result.content, result.isError));
        }
        messages.push(...resultsThenImages(results));
        continue;
      }

      switch (finishReason) {
        case 'length':
          return finish('max_tokens');
        case 'content_filter':
          text += REFUSAL_MESSAGE;
          events.onText(REFUSAL_MESSAGE);
          return finish('refusal');
        default:
          return finish('end');
      }
    }
  }

  /** Turns an SDK failure into something worth showing a person. */
  #toBrainError(error: unknown, model?: string): BrainError {
    const label = this.#label;
    if (error instanceof RateLimitError) {
      return new BrainError('rate_limit', `${label} is rate limiting us. Try again in a moment.`, {
        cause: error,
      });
    }
    if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
      return new BrainError('auth', `${label} rejected the API key. Check it in Settings.`, {
        cause: error,
      });
    }
    if (error instanceof NotFoundError) {
      // No model means the request was not about one: the base URL itself is wrong.
      const message =
        model === undefined
          ? `${label} answered 404 at ${this.#baseURL}. Check the base URL in Settings.`
          : `${label} does not serve the model '${model}'. Pick another one in Settings.`;
      return new BrainError('config', message, { cause: error });
    }
    if (error instanceof APIConnectionError) {
      return new BrainError('connection', `Could not reach ${label}. Check your connection.`, {
        cause: error,
      });
    }
    return new BrainError('unknown', `${label} request failed: ${String(error)}`, {
      cause: error,
    });
  }
}
