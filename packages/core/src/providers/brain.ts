/**
 * The provider-neutral brain contract every model provider implements. Contains
 * `BrainProvider`, the request, message, content and result types, and `REFUSAL_MESSAGE`.
 * The runner and every wrapper (guard, record, meter) speak only these types.
 */

/** Shown instead of an empty bubble when the model declines to answer. Every provider uses it. */
export const REFUSAL_MESSAGE =
  "I'd rather not answer that one. Try rephrasing it, or ask me something else.";

export interface BrainCapabilities {
  vision: boolean;
  tools: boolean;
}

/**
 * The blocks that carry payload a model reads directly.
 *
 * Split out of `BrainContent` so a tool result can reuse exactly these — an image inside
 * a tool result is the same picture as an image inside a message, and a second image
 * shape would have to be kept in step with this one forever.
 */
export type BrainContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: 'image/png' | 'image/jpeg'; base64: string };

/**
 * `tool_result.content` stays `string` for the common case and widens to blocks only when
 * a tool has something a model must *see*. Most results are plain prose and always will
 * be; forcing every one of them into a single-element array to serve the one tool that
 * returns pixels would churn every call site to buy nothing.
 *
 * The block array is provider-neutral: each provider translates it into its own wire
 * format, as `AnthropicProvider` does into SDK blocks. Nothing here mirrors Anthropic's
 * wire format.
 */
export type BrainContent =
  | BrainContentBlock
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string | BrainContentBlock[];
      isError?: boolean;
    };

export interface BrainMessage {
  role: 'user' | 'assistant';
  content: BrainContent[];
}

export interface BrainTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BrainRequest {
  model: string;
  /**
   * The model to switch to when the turn carries an image and `model` cannot see.
   * Providers that route by model read it; the rest ignore it. See `modelForTurn`.
   */
  visionModel?: string | undefined;
  system: string;
  messages: BrainMessage[];
  tools?: BrainTool[];
  maxTokens: number;
}

export interface BrainEvents {
  onText(delta: string): void;
  /** Resolves with the tool's output, which the provider sends back to the model. */
  onToolUse(call: {
    id: string;
    name: string;
    input: unknown;
  }): Promise<{ content: string | BrainContentBlock[]; isError?: boolean }>;
}

export interface BrainResult {
  text: string;
  stopReason: 'end' | 'max_tokens' | 'aborted' | 'refusal';
  usage: { inputTokens: number; outputTokens: number };
}

export interface BrainProvider {
  id: string;
  capabilities: BrainCapabilities;
  listModels(): Promise<string[]>;
  /**
   * Whether one model of this provider accepts images. Absent means every model does,
   * as long as `capabilities.vision` is set. Only a provider whose models differ — a
   * chat-completions server with text-only and vision models side by side — needs it.
   */
  canSee?(model: string): boolean;
  complete(req: BrainRequest, events: BrainEvents, signal: AbortSignal): Promise<BrainResult>;
}
