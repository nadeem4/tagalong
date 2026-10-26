/**
 * A TCP port that was free a moment ago, for specs that need the app to dial nothing real:
 * bind to 0, read the port, release it.
 */
import { createServer } from 'node:net';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}
