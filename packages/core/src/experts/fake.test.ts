import { describe, expect, it } from 'vitest';
import { FakeConnector } from './fake';

describe('FakeConnector', () => {
  it('reports its progress steps, then returns the scripted answer', async () => {
    const connector = new FakeConnector({ steps: ['Reading', 'Thinking'], text: 'Done.' });
    const progress: string[] = [];
    const result = await connector.send({ ask: 'Help' }, (step) => progress.push(step));
    expect(progress).toEqual(['Reading', 'Thinking']);
    expect(result).toEqual({ ok: true, text: 'Done.', changedFiles: [] });
  });

  it('remembers the briefs it was sent', async () => {
    const connector = new FakeConnector({ text: 'ok' });
    await connector.send({ ask: 'first' }, () => {});
    expect(connector.sent.map((b) => b.ask)).toEqual(['first']);
  });

  it('can be scripted to fail', async () => {
    const connector = new FakeConnector({ error: 'not signed in' });
    expect(await connector.send({ ask: 'x' }, () => {})).toEqual({
      ok: false,
      error: 'not signed in',
    });
  });

  it('stops when aborted', async () => {
    const connector = new FakeConnector({ text: 'late' });
    const controller = new AbortController();
    controller.abort();
    const result = await connector.send({ ask: 'x' }, () => {}, controller.signal);
    expect(result).toEqual({ ok: false, error: 'Cancelled.' });
  });
});

describe('FakeConnector.check', () => {
  it('passes unless scripted not to', async () => {
    expect(await new FakeConnector({}).check()).toEqual({ ok: true });
    expect(await new FakeConnector({ checkError: 'gone' }).check()).toEqual({
      ok: false,
      error: 'gone',
    });
  });
});
