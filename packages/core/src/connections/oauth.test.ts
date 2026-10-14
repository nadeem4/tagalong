import { afterEach, describe, expect, it } from 'vitest';
import { startLoopback, type Loopback } from './oauth';

let loopback: Loopback | undefined;

afterEach(() => {
  loopback?.close();
  loopback = undefined;
});

async function visit(query: string): Promise<number> {
  const response = await fetch(`${loopback?.redirectUrl}?${query}`);
  await response.text();
  return response.status;
}

describe('the sign-in loopback', () => {
  it('hands back the code whose state matches', async () => {
    loopback = await startLoopback();
    const waiting = loopback.code(() => 'right-state', 5_000);
    await visit('code=abc&state=right-state');
    await expect(waiting).resolves.toBe('abc');
  });

  it('ignores a code with a forged state, and still takes the real one after it', async () => {
    loopback = await startLoopback();
    const waiting = loopback.code(() => 'right-state', 5_000);
    await visit('code=evil&state=forged');
    await visit('code=good&state=right-state');
    await expect(waiting).resolves.toBe('good');
  });

  it('never accepts a forged state on its own', async () => {
    loopback = await startLoopback();
    const waiting = loopback.code(() => 'right-state', 200);
    await visit('code=evil&state=forged');
    await expect(waiting).rejects.toThrow('sign-in timed out');
  });

  it('stops waiting at once when the app sends an error back', async () => {
    loopback = await startLoopback();
    const waiting = loopback.code(() => 'right-state', 60_000);
    const status = await visit('error=access_denied&state=right-state');
    expect(status).toBe(400);
    await expect(waiting).rejects.toThrow('access_denied');
  });

  it('does not let an error with a forged state stop the sign-in', async () => {
    loopback = await startLoopback();
    const waiting = loopback.code(() => 'right-state', 5_000);
    await visit('error=access_denied&state=forged');
    await visit('code=good&state=right-state');
    await expect(waiting).resolves.toBe('good');
  });
});
