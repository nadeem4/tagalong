/**
 * Catches a web sign-in's one redirect on this PC's loopback. The brain registered
 * `http://127.0.0.1:<port>/callback` with the app's server, so the browser here reaches this
 * process. It serves the one callback and then lets the port go.
 */
import { createServer } from 'node:http';

export interface Redirect {
  code: string;
  state: string;
  iss?: string;
}

export interface Listening {
  port: number;
  redirect: Promise<Redirect>;
  close: () => void;
}

const PAGE =
  '<!doctype html><meta charset=utf-8><title>Tagalong</title><p>You can close this tab and go back to Tagalong.</p>';

export function listenForRedirect(port: number): Promise<Listening> {
  return new Promise((resolveListening, rejectListening) => {
    let settle: { resolve: (r: Redirect) => void; reject: (e: Error) => void };
    const redirect = new Promise<Redirect>((resolve, reject) => {
      settle = { resolve, reject };
    });
    redirect.catch(() => undefined);
    const shut = (): void => {
      server.close();
      server.closeAllConnections();
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' }).end(PAGE);
      const code = url.searchParams.get('code');
      const declined = url.searchParams.has('error');
      if (!declined && !code) return;
      if (declined || !code) settle.reject(new Error('The sign-in was declined.'));
      else {
        const iss = url.searchParams.get('iss');
        settle.resolve({
          code,
          state: url.searchParams.get('state') ?? '',
          ...(iss === null ? {} : { iss }),
        });
      }
      shut();
    });
    server.once('error', rejectListening);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolveListening({
        port: typeof address === 'object' && address !== null ? address.port : port,
        redirect,
        close: shut,
      });
    });
  });
}
