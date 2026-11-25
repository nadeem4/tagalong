/**
 * Tests for the requests a remote brain leaves on this PC: what the card shows, what a click runs,
 * what "not now" keeps, and the approved list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NeedsYouItem } from '@tagalong/ui/shapes';
import { RpcError } from '@tagalong/contract';
import type { Redirect } from './loopback';
import { createNeedsYou } from './needs';

const open = (over: object = {}) => ({
  seq: 1,
  id: 'n1',
  state: 'open',
  node: 'node-1',
  need: 'approve',
  spec: { command: 'claude-agent-acp', args: ['--stdio'] },
  expert: 'claude-code',
  ...over,
});

function rig(
  run: (args: string[]) => Promise<{ code: number; out: string }> = async () => ({
    code: 0,
    out: '',
  }),
) {
  const calls: string[][] = [];
  const answers: Array<[string, string]> = [];
  const redirects: Array<Redirect | undefined> = [];
  const listened: number[] = [];
  const opened: string[] = [];
  const closed: number[] = [];
  const caught: Array<(redirect: Redirect) => void> = [];
  const brainAnswers = { fail: false, refuse: false };
  const portTaken = { yes: false };
  const pushed: NeedsYouItem[][] = [];
  const needs = createNeedsYou({
    run: async (args) => {
      if (args[1] === 'which') {
        return args[2] === 'claude-agent-acp' || args[3] === 'claude-code'
          ? { code: 0, out: 'C:\\tools\\claude-agent-acp.cmd\n' }
          : { code: 1, out: 'not a program' };
      }
      calls.push(args);
      return run(args);
    },
    answer: async (id, outcome, redirect) => {
      if (brainAnswers.fail) throw new Error('offline');
      if (brainAnswers.refuse) throw new RpcError(-32004, 'That request is no longer open.');
      answers.push([id, outcome]);
      redirects.push(redirect);
    },
    catchRedirect: async (port) => {
      if (portTaken.yes) throw new Error('EADDRINUSE');
      listened.push(port);
      return {
        port,
        redirect: new Promise<Redirect>((resolve) => caught.push(resolve)),
        close: () => void closed.push(port),
      };
    },
    openUrl: async (url) => void opened.push(url),
    brain: async () => ({ name: 'mini-pc', identity: '4F2A-91C0' }),
    push: (items) => void pushed.push(items),
  });
  return {
    needs,
    calls,
    answers,
    pushed,
    redirects,
    listened,
    opened,
    closed,
    caught,
    brainAnswers,
    portTaken,
  };
}

describe('needs you on this PC', () => {
  it('shows what this PC resolves and who is asking, not text from the frame', async () => {
    const { needs, pushed } = rig();
    await needs.frame(
      open({ spec: { command: 'claude-agent-acp', args: [] }, brain: 'evil', path: 'C:\\x' }),
    );
    expect(needs.list()).toEqual([
      expect.objectContaining({
        id: 'n1',
        need: 'approve',
        brain: 'mini-pc',
        identity: '4F2A-91C0',
        what: 'claude-agent-acp',
        path: 'C:\\tools\\claude-agent-acp.cmd',
        state: 'waiting',
        bubble: true,
      }),
    ]);
    expect(pushed).toHaveLength(1);
  });

  it('allow runs the allow command with the exact program and arguments, then tells the brain', async () => {
    const { needs, calls, answers } = rig();
    await needs.frame(open({ spec: { command: 'claude-agent-acp', args: ['--stdio', 'a b'] } }));
    expect(await needs.act('n1')).toEqual({});
    expect(calls).toEqual([['node', 'allow', 'claude-agent-acp', '--', '--stdio', 'a b']]);
    expect(answers).toEqual([['n1', 'done']]);
    expect(needs.list()).toEqual([]);
  });

  it("allow of an expert names it by id and shows this PC's own install of it", async () => {
    const { needs, calls } = rig();
    await needs.frame(open({ spec: { expert: 'claude-code' } }));
    expect(needs.list()[0]).toMatchObject({
      what: 'claude-code',
      path: 'C:\\tools\\claude-agent-acp.cmd',
    });
    await needs.act('n1');
    expect(calls).toEqual([['node', 'allow', '--expert', 'claude-code']]);
  });

  it('install runs the install command for the expert, then tells the brain', async () => {
    const { needs, calls, answers } = rig();
    await needs.frame(open({ id: 'i1', need: 'install', spec: { expert: 'claude-code' } }));
    expect(needs.list()[0]).toMatchObject({ need: 'install', expert: 'claude-code', path: null });
    expect(await needs.act('i1')).toEqual({});
    expect(calls).toEqual([['install', 'claude-code', '--yes']]);
    expect(answers).toEqual([['i1', 'done']]);
  });

  it('allow of an address uses --url', async () => {
    const { needs, calls } = rig();
    await needs.frame(open({ spec: { url: 'https://mcp.example/x' } }));
    await needs.act('n1');
    expect(calls).toEqual([['node', 'allow', '--url', 'https://mcp.example/x']]);
  });

  it('sign-in runs the expert login command', async () => {
    const { needs, calls } = rig();
    await needs.frame(open({ id: 's', need: 'signin' }));
    await needs.act('s');
    expect(calls).toEqual([['login', 'claude-code']]);
  });

  it('a failed command keeps the request, with the last line of why, and tells the brain nothing', async () => {
    const { needs, answers } = rig(async () => ({ code: 1, out: 'starting\nno network' }));
    await needs.frame(open());
    expect(await needs.act('n1')).toEqual({ error: 'no network' });
    expect(answers).toEqual([]);
    expect(needs.list()[0]).toMatchObject({ state: 'failed', failure: 'no network' });
  });

  it('not now closes the bubble, keeps the request in Home and tells the brain', async () => {
    const { needs, answers } = rig();
    await needs.frame(open());
    await needs.notNow('n1');
    expect(answers).toEqual([['n1', 'not_now']]);
    expect(needs.list()[0]).toMatchObject({ bubble: false, state: 'waiting' });
  });

  it('a closed frame removes the request', async () => {
    const { needs } = rig();
    await needs.frame(open());
    await needs.frame({ seq: 2, id: 'n1', state: 'closed', reason: 'timeout' });
    expect(needs.list()).toEqual([]);
  });

  it('refuses to run a request whose program or expert looks like an option', async () => {
    const { needs, calls, answers } = rig();
    await needs.frame(open({ spec: { command: '--version' } }));
    await needs.frame(open({ id: 'i', need: 'signin', expert: '-y' }));
    await needs.frame(open({ id: 'j', need: 'install', expert: '-y', spec: { expert: '-y' } }));
    expect(await needs.act('n1')).toEqual({ error: 'This PC will not run that.' });
    expect(await needs.act('i')).toEqual({ error: 'This PC will not run that.' });
    expect(await needs.act('j')).toEqual({ error: 'This PC will not run that.' });
    expect(calls).toEqual([]);
    expect(answers).toEqual([]);
  });

  it('lists what is approved here, and revokes one by its key', async () => {
    const { needs, calls } = rig(async (args) =>
      args[1] === 'list'
        ? {
            code: 0,
            out: JSON.stringify([
              {
                key: 'k1',
                command: 'claude',
                args: ['--x'],
                path: 'C:\\c.exe',
                at: '2026-11-01T10:00:00+00:00',
              },
              { key: 'k2', url: 'https://m.example' },
            ]),
          }
        : { code: 0, out: '' },
    );
    expect(await needs.approved()).toEqual([
      { key: 'k1', what: 'claude --x', path: 'C:\\c.exe', at: '2026-11-01T10:00:00+00:00' },
      { key: 'k2', what: 'https://m.example' },
    ]);
    await needs.revoke('k1');
    expect(calls.at(-1)).toEqual(['node', 'revoke', 'k1']);
  });

  it('a click that races a request the brain already closed does not reject', async () => {
    const { needs, brainAnswers } = rig();
    await needs.frame(open());
    brainAnswers.refuse = true;
    await expect(needs.act('n1')).resolves.toEqual({});
    await expect(needs.notNow('n1')).resolves.toBeUndefined();
  });

  describe('an app sign-in that finishes on this PC', () => {
    const signin = (over: object = {}) => ({
      seq: 1,
      id: 'a1',
      state: 'open',
      need: 'app_signin',
      app: 'Gmail',
      url: 'https://accounts.example/authorize?state=s1',
      port: 53211,
      ...over,
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    afterEach(() => vi.useRealTimers());

    it('opens the page here, listens on the port the brain registered, and names the app', async () => {
      const { needs, listened, opened } = rig();
      expect(await needs.frame(signin())).toBe(true);
      await vi.waitFor(() =>
        expect(opened).toEqual(['https://accounts.example/authorize?state=s1']),
      );
      expect(listened).toEqual([53211]);
      expect(needs.list()).toEqual([
        expect.objectContaining({
          id: 'a1',
          need: 'app_signin',
          brain: 'mini-pc',
          what: 'Gmail',
          path: null,
          state: 'waiting',
        }),
      ]);
    });

    it('sends only the code, state and issuer to the brain, then shows it done and lets it go', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const { needs, answers, redirects, closed, caught } = rig();
      await needs.frame(signin());
      caught[0]?.({ code: 'c1', state: 's1', iss: 'https://accounts.example' });
      await settle();
      expect(needs.list()[0]?.state).toBe('done');
      expect(answers).toEqual([['a1', 'done']]);
      expect(redirects).toEqual([{ code: 'c1', state: 's1', iss: 'https://accounts.example' }]);
      expect(closed).toEqual([53211]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(needs.list()).toEqual([]);
    });

    it('says the brain did not answer after 30 seconds, and Try again sends the same code', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const { needs, answers, redirects, caught, brainAnswers } = rig();
      brainAnswers.fail = true;
      await needs.frame(signin());
      caught[0]?.({ code: 'c1', state: 's1' });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(needs.list()[0]).toMatchObject({
        state: 'failed',
        failure:
          'Gmail sent you back, but mini-pc did not accept it. Nothing was saved. Check mini-pc is on and try again, or press Not now and ask Scout to sign in again.',
      });
      brainAnswers.fail = false;
      expect(await needs.act('a1')).toEqual({});
      expect(needs.list()[0]?.state).toBe('done');
      expect(answers).toEqual([['a1', 'done']]);
      expect(redirects).toEqual([{ code: 'c1', state: 's1' }]);
    });

    it('when the brain refuses the code it shows the reason with no Try again and drops the code', async () => {
      const { needs, answers, caught, brainAnswers } = rig();
      brainAnswers.refuse = true;
      await needs.frame(signin());
      caught[0]?.({ code: 'c1', state: 'bad' });
      await vi.waitFor(() => expect(needs.list()[0]?.state).toBe('failed'));
      expect(needs.list()[0]).toMatchObject({
        failure: 'That request is no longer open.',
        canRetry: false,
      });
      expect(await needs.act('a1')).toEqual({});
      expect(answers).toEqual([]);
    });

    it('says to press Not now and ask again when this PC cannot listen on the port', async () => {
      const { needs, portTaken } = rig();
      portTaken.yes = true;
      await needs.frame(signin());
      await vi.waitFor(() => expect(needs.list()[0]?.state).toBe('failed'));
      expect(needs.list()[0]?.failure).toBe(
        'This PC could not listen for the sign-in on port 53211. Press Not now, then ask Scout to sign in again to get a new port.',
      );
    });

    it('a frame replayed on reconnect neither listens again nor reopens the page', async () => {
      const { needs, listened, opened } = rig();
      await needs.frame(signin());
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      expect(await needs.frame(signin())).toBe(false);
      await settle();
      expect(listened).toEqual([53211]);
      expect(opened).toHaveLength(1);
    });

    it('Open it again opens the same page, not a new sign-in', async () => {
      const { needs, opened } = rig();
      await needs.frame(signin());
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      await needs.act('a1');
      expect(opened).toEqual(Array(2).fill('https://accounts.example/authorize?state=s1'));
    });

    it('not now with the brain offline still drops the card', async () => {
      const { needs, brainAnswers } = rig();
      await needs.frame(signin());
      brainAnswers.fail = true;
      await needs.notNow('a1');
      expect(needs.list()).toEqual([]);
    });

    it('not now stops listening and tells the brain', async () => {
      const { needs, answers, closed } = rig();
      await needs.frame(signin());
      await needs.notNow('a1');
      expect(answers).toEqual([['a1', 'not_now']]);
      expect(closed).toEqual([53211]);
    });

    it('a redirect that arrives after not now is not sent to the brain', async () => {
      const { needs, answers, caught } = rig();
      await needs.frame(signin());
      await needs.notNow('a1');
      caught[0]?.({ code: 'late', state: 's1' });
      await settle();
      expect(answers).toEqual([['a1', 'not_now']]);
    });

    it('a closed frame stops listening and removes it', async () => {
      const { needs, closed } = rig();
      await needs.frame(signin());
      await needs.frame({ seq: 2, id: 'a1', state: 'closed', reason: 'timeout' });
      expect(closed).toEqual([53211]);
      expect(needs.list()).toEqual([]);
    });

    it('the brain closing it after the code arrived does not hide the done line', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const { needs, caught } = rig();
      await needs.frame(signin());
      caught[0]?.({ code: 'c1', state: 's1' });
      await settle();
      await needs.frame({ seq: 2, id: 'a1', state: 'closed', reason: 'answered' });
      expect(needs.list()[0]?.state).toBe('done');
    });
  });
});
