/**
 * The catch for a web sign-in's redirect on this PC: one callback with a code is handed over and
 * the port is released; anything else is turned away.
 */
import { describe, expect, it } from 'vitest';
import { listenForRedirect } from './loopback';

const get = (port: number, path: string) => fetch(`http://127.0.0.1:${port}${path}`);

describe('listenForRedirect', () => {
  it('hands over the code, state and issuer of the callback, then closes the port', async () => {
    const listening = await listenForRedirect(0);
    const reply = await get(
      listening.port,
      '/callback?code=c1&state=s1&iss=https%3A%2F%2Fi.example',
    );
    expect(reply.status).toBe(200);
    expect(await listening.redirect).toEqual({ code: 'c1', state: 's1', iss: 'https://i.example' });
    await expect(get(listening.port, '/callback?code=c2&state=s1')).rejects.toThrow();
  });

  it('turns away other paths and keeps listening', async () => {
    const listening = await listenForRedirect(0);
    expect((await get(listening.port, '/other?code=x&state=y')).status).toBe(404);
    await get(listening.port, '/callback?code=c1&state=s1');
    expect(await listening.redirect).toMatchObject({ code: 'c1' });
  });

  it('reports a declined sign-in', async () => {
    const listening = await listenForRedirect(0);
    const failed = expect(listening.redirect).rejects.toThrow('The sign-in was declined.');
    await get(listening.port, '/callback?error=access_denied&state=s1');
    await failed;
  });

  it('fails when the port is already taken', async () => {
    const first = await listenForRedirect(0);
    await expect(listenForRedirect(first.port)).rejects.toThrow();
    first.close();
  });
});
