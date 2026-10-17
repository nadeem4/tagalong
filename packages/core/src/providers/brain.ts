/**
 * The provider-neutral brain contract every model provider implements. Contains
 * `BrainProvider` and the request, message, content and result types.
 * The runner and every wrapper (guard, record, meter) speak only these types.
 */

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
  /**
   * `refusal`: the model declined; `tool_limit`: it kept calling tools past the step cap.
   * Both come with no text of their own, so Scout never speaks a canned line.
   */
  stopReason: 'end' | 'max_tokens' | 'aborted' | 'refusal' | 'tool_limit';
  usage: { inputTokens: number; outputTokens: number };
}

export interface BrainProvider {
  id: string;
  capabilities: BrainCapabilities;
  complete(req: BrainRequest, events: BrainEvents, signal: AbortSignal): Promise<BrainResult>;
}
