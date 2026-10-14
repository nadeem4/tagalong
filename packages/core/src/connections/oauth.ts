import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { SecretStore } from '../settings/settings';

/** Where one connection's OAuth client and tokens are kept: the secret store, one entry. */
export function oauthSecretKey(connectionId: string): string {
  return `connection.${connectionId}.oauth`;
}

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  redirectUrl?: string;
}

/**
 * The SDK's OAuth client, backed by the host's secret store. The registered client and the
 * tokens are one encrypted entry; the PKCE verifier and the state live only in memory for
 * the one sign-in. `onRedirect` absent means no sign-in may start (a connect at launch):
 * the person is told to sign in instead of a browser opening on its own.
 */
export class SecretOAuthProvider implements OAuthClientProvider {
  #verifier = '';
  #state = '';
  #redirectUrl: string | undefined;
  /** True once the SDK asked to send the person to the app's sign-in page. */
  redirected = false;

  constructor(
    private readonly options: {
      secrets: SecretStore;
      connectionId: string;
      redirectUrl?: string | undefined;
      onRedirect?: ((url: URL) => void | Promise<void>) | undefined;
    },
  ) {
    this.#redirectUrl = options.redirectUrl;
  }

  get redirectUrl(): string {
    return this.#redirectUrl ?? 'http://127.0.0.1/callback';
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Tagalong',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /** The state the loopback must see back, so a forged redirect is refused. */
  get expectedState(): string {
    return this.#state;
  }

  state(): string {
    this.#state = randomBytes(16).toString('hex');
    return this.#state;
  }

  async #read(): Promise<Stored> {
    const text = await this.options.secrets.get(oauthSecretKey(this.options.connectionId));
    if (text === null) return {};
    try {
      return JSON.parse(text) as Stored;
    } catch {
      return {};
    }
  }

  async #write(patch: Partial<Stored>): Promise<void> {
    const next = { ...(await this.#read()), ...patch };
    await this.options.secrets.set(oauthSecretKey(this.options.connectionId), JSON.stringify(next));
  }

  /** A launch reconnects with the redirect the client was registered with. */
  async load(): Promise<void> {
    this.#redirectUrl ??= (await this.#read()).redirectUrl;
  }

  async hasTokens(): Promise<boolean> {
    return (await this.#read()).tokens !== undefined;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.#read()).client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.#write({ client, redirectUrl: this.redirectUrl });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.#read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.#write({ tokens });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (this.options.onRedirect === undefined) return;
    this.redirected = true;
    await this.options.onRedirect(url);
  }

  saveCodeVerifier(verifier: string): void {
    this.#verifier = verifier;
  }

  codeVerifier(): string {
    return this.#verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'verifier' || scope === 'discovery') return;
    const stored = await this.#read();
    if (scope !== 'tokens') delete stored.client;
    if (scope !== 'client') delete stored.tokens;
    await this.options.secrets.set(
      oauthSecretKey(this.options.connectionId),
      JSON.stringify(stored),
    );
  }

  /** A new sign-in registers again, for this sign-in's own loopback address. */
  async forgetClient(): Promise<void> {
    await this.invalidateCredentials('client');
  }
}

export interface Loopback {
  redirectUrl: string;
  /** The code the app sent back, once its state matches. Rejects after `timeoutMs`. */
  code(expectedState: () => string, timeoutMs: number): Promise<string>;
  close(): void;
}

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Tagalong</title>' +
  '<p style="font:16px system-ui;margin:3rem">You are signed in. You can close this tab and go back to Tagalong.</p>';
const FAILED_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Tagalong</title>' +
  '<p style="font:16px system-ui;margin:3rem">That sign-in did not work. Go back to Tagalong and try again.</p>';

/**
 * A one-sign-in web server on 127.0.0.1, any free port, answering only `/callback`. The
 * app's sign-in page sends the browser here with a code; the server is closed after.
 */
export async function startLoopback(): Promise<Loopback> {
  const received: { code: string; state: string }[] = [];
  let notify: (() => void) | undefined;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    if (url.pathname !== '/callback' || code === null) {
      response.writeHead(400, { 'content-type': 'text/html' }).end(FAILED_PAGE);
      return;
    }
    received.push({ code, state: url.searchParams.get('state') ?? '' });
    notify?.();
    response.writeHead(200, { 'content-type': 'text/html' }).end(DONE_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    redirectUrl: `http://127.0.0.1:${port}/callback`,
    code(expectedState, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sign-in timed out')), timeoutMs);
        const check = () => {
          const match = received.find((r) => r.state === expectedState());
          if (match === undefined) return;
          clearTimeout(timer);
          resolve(match.code);
        };
        notify = check;
        check();
      });
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
