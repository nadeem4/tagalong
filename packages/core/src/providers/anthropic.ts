import Anthropic, {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  Message,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  BrainCapabilities,
  BrainContent,
  BrainContentBlock,
  BrainEvents,
  BrainMessage,
  BrainProvider,
  BrainRequest,
  BrainResult,
  BrainTool,
} from './brain';
import { BrainError } from './errors';

/** Shown instead of an empty bubble when the model declines to answer. */
export const REFUSAL_MESSAGE =
  "I'd rather not answer that one. Try rephrasing it, or ask me something else.";

/**
 * Models this provider is known to serve. Kept as a list rather than a `models.list`
 * call so settings UI and tests never depend on the network.
 */
const ANTHROPIC_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Overridable for proxies and gateways; omitted means the SDK default. */
  baseURL?: string;
}

/**
 * Images lead. Claude answers questions about an image far more reliably when the
 * picture arrives before the words asking about it — inside a tool result as much as
 * inside a message, so both paths run through here.
 */
function imagesFirst<T extends { type: string }>(blocks: readonly T[]): T[] {
  return [...blocks.filter((b) => b.type === 'image'), ...blocks.filter((b) => b.type !== 'image')];
}

type ToolResultContent = NonNullable<ToolResultBlockParam['content']>;

function toToolResultContent(content: string | BrainContentBlock[]): ToolResultContent {
  if (typeof content === 'string') return content;
  return imagesFirst(content).map(toContentBlock) as ToolResultContent;
}

function toContentBlock(block: BrainContent): ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mime, data: block.base64 },
      };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: toToolResultContent(block.content),
        ...(block.isError === undefined ? {} : { is_error: block.isError }),
      };
  }
}

function toMessageParam(message: BrainMessage): MessageParam {
  return { role: message.role, content: imagesFirst(message.content).map(toContentBlock) };
}

function toTool(tool: BrainTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool.InputSchema,
  };
}

function mapStopReason(stopReason: string | null): BrainResult['stopReason'] {
  switch (stopReason) {
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end';
  }
}

/** Turns an SDK failure into something worth showing a person. */
function toBrainError(error: unknown): BrainError {
  if (error instanceof RateLimitError) {
    return new BrainError('rate_limit', 'Claude is rate limiting us. Try again in a moment.', {
      cause: error,
    });
  }
  if (error instanceof AuthenticationError) {
    return new BrainError('auth', 'Claude rejected the API key. Check it in Settings.', {
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new BrainError('connection', 'Could not reach Claude. Check your connection.', {
      cause: error,
    });
  }
  return new BrainError('unknown', `Claude request failed: ${String(error)}`, { cause: error });
}

export class AnthropicProvider implements BrainProvider {
  readonly id = 'anthropic';
  readonly capabilities: BrainCapabilities = { vision: true, tools: true, streaming: true };

  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    });
  }

  listModels(): Promise<string[]> {
    return Promise.resolve([...ANTHROPIC_MODELS]);
  }

  async complete(
    req: BrainRequest,
    events: BrainEvents,
    signal: AbortSignal,
  ): Promise<BrainResult> {
    const messages = req.messages.map(toMessageParam);
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const finish = (stopReason: BrainResult['stopReason']): BrainResult => ({
      text,
      stopReason,
      usage: { inputTokens, outputTokens },
    });

    // The loop only ever repeats for tool use; every other stop reason returns.
    for (;;) {
      if (signal.aborted) return finish('aborted');

      let message: Message;
      try {
        const stream = this.client.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            // The cache breakpoint sits at the end of the stable prefix — tools and
            // persona — so only the volatile context snapshot is re-read each turn.
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages,
            thinking: { type: 'adaptive' },
            ...(req.tools === undefined ? {} : { tools: req.tools.map(toTool) }),
          },
          { signal },
        );
        stream.on('text', (delta) => {
          text += delta;
          events.onText(delta);
        });
        message = await stream.finalMessage();
      } catch (error) {
        if (error instanceof APIUserAbortError) return finish('aborted');
        throw toBrainError(error);
      }

      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;

      if (message.stop_reason === 'tool_use') {
        // The assistant turn goes back verbatim so thinking signatures survive.
        messages.push({ role: 'assistant', content: message.content });
        const results: ToolResultBlockParam[] = [];
        for (const block of message.content) {
          if (block.type !== 'tool_use') continue;
          const result = await events.onToolUse({
            id: block.id,
            name: block.name,
            input: block.input,
          });
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toToolResultContent(result.content),
            ...(result.isError === undefined ? {} : { is_error: result.isError }),
          });
        }
        // One user message carrying every result: the API rejects them split up.
        messages.push({ role: 'user', content: results });
        continue;
      }

      if (message.stop_reason === 'refusal') {
        text += REFUSAL_MESSAGE;
        events.onText(REFUSAL_MESSAGE);
      }

      return finish(mapStopReason(message.stop_reason));
    }
  }
}
