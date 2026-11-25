/**
 * An app that stays on the brain asks for its web sign-in to finish on this PC: the page opens
 * in this PC's browser, the redirect is caught on this PC's loopback, and only the one-time code
 * goes to the brain. Holds those requests apart from the approve and sign-in ones in needs.ts.
 */
import type { NodeNeedsOpen } from '@tagalong/contract';
import { DONE_HOLD_MS, type NeedsYouItem } from '@tagalong/ui/shapes';
import type { Listening, Redirect } from './loopback';

const BRAIN_ANSWER_MS = 30_000;

type AppSignin = Extract<NodeNeedsOpen, { need: 'app_signin' }>;

interface Signin {
  frame: AppSignin;
  brain: { name: string; identity?: string | undefined };
  state: NeedsYouItem['state'];
  bubble: boolean;
  failure?: string;
  listening?: Listening;
  redirect?: Redirect;
  hold?: ReturnType<typeof setTimeout>;
}

export interface SigninDeps {
  answer: (id: string, outcome: 'done' | 'not_now', redirect?: Redirect) => Promise<void>;
  catchRedirect: (port: number) => Promise<Listening>;
  openUrl: (url: string) => Promise<void>;
  brain: () => Promise<Signin['brain']>;
  changed: () => void;
}

export function createSignin(deps: SigninDeps) {
  const open = new Map<string, Signin>();
  const arriving = new Set<string>();

  const stopListening = (s: Signin): void => {
    s.listening?.close();
    delete s.listening;
  };
  const drop = (s: Signin): void => {
    stopListening(s);
    clearTimeout(s.hold);
    open.delete(s.frame.id);
  };
  const fail = (s: Signin, failure: string): void => {
    s.state = 'failed';
    s.failure = failure;
    deps.changed();
  };

  const sendCode = async (s: Signin): Promise<{ error?: string }> => {
    if (s.redirect === undefined) return {};
    s.state = 'working';
    delete s.failure;
    deps.changed();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answered = await Promise.race([
      deps.answer(s.frame.id, 'done', s.redirect).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(resolve, BRAIN_ANSWER_MS, false);
      }),
    ]);
    clearTimeout(timer);
    if (open.get(s.frame.id) !== s) return {};
    if (!answered) {
      const { name } = s.brain;
      fail(
        s,
        `The sign-in page sent you back, but ${name} did not answer. Nothing was saved. Check ${name} is on, then try again.`,
      );
      return { error: s.failure ?? '' };
    }
    s.state = 'done';
    s.hold = setTimeout(() => {
      drop(s);
      deps.changed();
    }, DONE_HOLD_MS);
    deps.changed();
    return {};
  };

  const begin = async (s: Signin): Promise<void> => {
    const { id, port, url } = s.frame;
    try {
      const listening = await deps.catchRedirect(port);
      if (open.get(id) !== s) {
        listening.close();
        return;
      }
      s.listening = listening;
      listening.redirect.then(
        (redirect) => {
          if (open.get(id) !== s) return;
          stopListening(s);
          s.redirect = redirect;
          void sendCode(s);
        },
        (err: Error) => {
          if (open.get(id) !== s) return;
          stopListening(s);
          fail(s, err.message);
        },
      );
      await deps.openUrl(url);
    } catch {
      fail(
        s,
        `This PC could not listen for the sign-in on port ${port}. Close what uses it and try again.`,
      );
    }
  };

  return {
    owns: (id: string): boolean => open.has(id),

    list: (): NeedsYouItem[] =>
      [...open.values()].map((s) => ({
        id: s.frame.id,
        need: 'app_signin',
        brain: s.brain.name,
        identity: s.brain.identity,
        what: s.frame.app,
        path: null,
        state: s.state,
        failure: s.failure,
        bubble: s.bubble,
      })),

    /** True when the request is now open here, so the caller can bring the card up. */
    async open(frame: AppSignin): Promise<boolean> {
      if (open.has(frame.id) || arriving.has(frame.id)) return false;
      if (new URL(frame.url).protocol !== 'https:') {
        await deps.answer(frame.id, 'not_now');
        return false;
      }
      arriving.add(frame.id);
      const brain = await deps.brain();
      if (!arriving.delete(frame.id)) return false;
      const s: Signin = { frame, brain, state: 'waiting', bubble: true };
      open.set(frame.id, s);
      deps.changed();
      void begin(s);
      return true;
    },

    /** The brain closed it. Once the code is on its way the card keeps telling the person. */
    close(id: string): void {
      arriving.delete(id);
      const s = open.get(id);
      if (s === undefined || s.state === 'working' || s.state === 'done') return;
      drop(s);
      deps.changed();
    },

    async act(id: string): Promise<{ error?: string }> {
      const s = open.get(id);
      if (s === undefined) return {};
      if (s.redirect !== undefined) return sendCode(s);
      if (s.listening === undefined) {
        s.state = 'waiting';
        delete s.failure;
        deps.changed();
        await begin(s);
      } else await deps.openUrl(s.frame.url);
      return {};
    },

    async notNow(id: string): Promise<void> {
      const s = open.get(id);
      if (s === undefined) return;
      drop(s);
      deps.changed();
      await deps.answer(id, 'not_now');
    },
  };
}
