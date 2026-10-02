/**
 * The provider-neutral brain contract.
 *
 * The runner talks to this interface and nothing else, so Ollama or an
 * OpenAI-compatible endpoint can be added later without touching conversation code.
 */

/** Shown instead of an empty bubble when the model declines to answer. Every provider uses it. */
export const REFUSAL_MESSAGE =
  "I'd rather not answer that one. Try rephrasing it, or ask me something else.";

export interface BrainCapabilities {
  vision: boolean;
  tools: boolean;
  streaming: boolean;
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
 * The block array is deliberately provider-neutral: an Ollama or OpenAI-compatible
 * provider translates it into whatever that API wants, exactly as `AnthropicProvider`
 * translates it into SDK blocks. Nothing here mirrors Anthropic's wire format.
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
  stopReason: 'end' | 'max_tokens' | 'aborted' | 'refusal';
  usage: { inputTokens: number; outputTokens: number };
}

export interface BrainProvider {
  id: string;
  capabilities: BrainCapabilities;
  listModels(): Promise<string[]>;
  complete(req: BrainRequest, events: BrainEvents, signal: AbortSignal): Promise<BrainResult>;
}
