import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * An MCP server in this process, for tests: no network, no real app. Each tool answers
 * from a function; `calls` records what the client sent.
 */
export interface FakeTool {
  name: string;
  description?: string;
  annotations?: McpTool['annotations'];
  run: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
}

export interface FakeMcpServer {
  /** A fresh linked pair for each connect: the server side is connected, the client side returned. */
  transport(): Promise<Transport>;
  calls: { name: string; args: Record<string, unknown> }[];
}

export function fakeMcpServer(tools: FakeTool[]): FakeMcpServer {
  const calls: FakeMcpServer['calls'] = [];
  return {
    calls,
    async transport() {
      const server = new Server(
        { name: 'fake', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: tools.map((tool) => ({
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          inputSchema: { type: 'object' as const, properties: {} },
          ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
        })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const args = request.params.arguments ?? {};
        calls.push({ name: request.params.name, args });
        const tool = tools.find((t) => t.name === request.params.name);
        if (tool === undefined)
          return { content: [{ type: 'text', text: 'no such tool' }], isError: true };
        return tool.run(args);
      });
      const [client, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      return client;
    },
  };
}

/**
 * A transport that behaves like a remote server behind OAuth, without one: with no token it
 * sends the person to a fake authorize page carrying the redirect and state, and refuses;
 * `finishAuth` turns the code into a token.
 */
export class FakeOAuthTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: NonNullable<Transport['onmessage']>;

  constructor(
    private readonly inner: Transport,
    private readonly auth: OAuthClientProvider,
  ) {}

  async start(): Promise<void> {
    const tokens = await this.auth.tokens();
    if (tokens === undefined) {
      const url = new URL('https://auth.example/authorize');
      url.searchParams.set('redirect_uri', String(this.auth.redirectUrl));
      const state = await this.auth.state?.();
      if (state !== undefined) url.searchParams.set('state', state);
      await this.auth.redirectToAuthorization(url);
      throw new UnauthorizedError();
    }
    this.inner.onmessage = (message, extra) => this.onmessage?.(message, extra);
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
    await this.inner.start();
  }

  async finishAuth(code: string): Promise<void> {
    await this.auth.saveTokens({ access_token: `token-${code}`, token_type: 'Bearer' });
  }

  send(...args: Parameters<Transport['send']>): Promise<void> {
    return this.inner.send(...args);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
