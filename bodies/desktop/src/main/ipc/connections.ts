/**
 * IPC for Home's connected apps and the answer to a change Scout asked to make in one. Apps go
 * through the brain's Home tools (list_apps, add_app, ...); the brain owns them, and a refusal or
 * an offline brain rejects here so the page can say so. Contains registerConnectionIpc and
 * forwardConnectionsChanged.
 */

import { ErrorCode } from '@tagalong/contract';
import { RpcError } from '@tagalong/contract';
import { AppAddParams, AppsList } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

/** What the brain's set_app_enabled takes. */
export const AppSetEnabledParams = z.object({ id: z.string().min(1), enabled: z.boolean() });
/** For the brain's remove_app, restart_app and sign_in_app. */
export const AppIdParams = z.object({ id: z.string().min(1) });

export interface ConnectionIpcDeps {
  /** Runs the brain's Home tools; rejects with BrainOffline while the brain is down. */
  brain: BrainCall;
  /** The person's click on a card: the brain's `answer` for that ask. */
  answer: (ask: string, decision: 'once' | 'always' | 'deny') => Promise<void>;
  /** The answer to a Claude Code job's ask: its own option name, plus typed text for a question. */
  reply: (ask: string, option: string, text?: string) => Promise<void>;
}

/** The brain's `changed` for apps reaches the page as `connections.changed`, no payload. */
export function forwardConnectionsChanged(
  what: string,
  forward: (notification: { method: string; params: unknown }) => void,
): void {
  if (what === 'apps') forward({ method: 'connections.changed', params: {} });
}

export function registerConnectionIpc(
  handle: IpcHandle,
  { brain, answer, reply }: ConnectionIpcDeps,
): void {
  // An ask the brain no longer has needs no answer; the card goes with its closed frame.
  // Anything else (offline, a failed send) rejects, so the card stays up to click again.
  const unlessGone = async (send: () => Promise<void>): Promise<void> => {
    try {
      await send();
    } catch (e) {
      if (e instanceof RpcError && e.code === ErrorCode.not_found) return;
      throw e;
    }
  };
  handle(
    IPC.approveTool,
    async (_event, approvalId: string, decision: 'once' | 'always' | 'deny') =>
      unlessGone(() => answer(approvalId, decision)),
  );
  handle(
    IPC.answerJobAsk,
    async (_event, approvalId: string, a: { option: string; text?: string }) =>
      unlessGone(() => reply(approvalId, a.option, a.text)),
  );
  handle(IPC.listConnections, async () => AppsList.parse(await callJson(brain, 'list_apps')));
  // Parsed here so a bad form is refused before the brain hears of it; the page is not trusted.
  handle(IPC.addConnection, async (_event, params: unknown) =>
    callJson(brain, 'add_app', AppAddParams.parse(params)),
  );
  handle(IPC.setConnectionEnabled, async (_event, id: unknown, enabled: unknown) =>
    callJson(brain, 'set_app_enabled', AppSetEnabledParams.parse({ id, enabled })),
  );
  handle(IPC.removeConnection, async (_event, id: unknown) =>
    callJson(brain, 'remove_app', AppIdParams.parse({ id })),
  );
  handle(IPC.restartConnection, async (_event, id: unknown) =>
    callJson(brain, 'restart_app', AppIdParams.parse({ id })),
  );
  // Returns at once; the outcome arrives as the app's state through `changed`.
  handle(IPC.signInConnection, async (_event, id: unknown) =>
    callJson(brain, 'sign_in_app', AppIdParams.parse({ id })),
  );
}
