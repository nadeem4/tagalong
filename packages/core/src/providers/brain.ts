/**
 * The provider-neutral brain contract.
 *
 * The runner talks to this interface and nothing else, so Ollama or an
 * OpenAI-compatible endpoint can be added later without touching conversation code.
 */

export interface BrainCapabilities {
  vision: boolean;
  tools: boolean;
  streaming: boolean;
}

export type BrainContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: 'image/png' | 'image/jpeg'; base64: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

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
  }): Promise<{ content: string; isError?: boolean }>;
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
