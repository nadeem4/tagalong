/**
 * What the desktop tells its panels while a turn runs: the stream of a turn, the brain's
 * confirm cards, Scout's own remarks and the apps changing. One plain union the preload,
 * the bubble and the dock all share. Contains TurnEvent, StopReason and PetRemarkParams.
 */
import type { ConnectorConfirmParams, ConnectorDismissParams } from './apps';

/** `refusal` and `tool_limit` come with empty text: the bubble shows a quiet status instead. */
export type StopReason = 'end' | 'aborted' | 'refusal' | 'tool_limit';

/** One short line Scout says on its own, from a wake: the brain's words, never a fixed line. */
export interface PetRemarkParams {
  remarkId: string;
  petId: string;
  text: string;
}

export type TurnEvent =
  | {
      type: 'turn.started';
      turnId: string;
      petId: string;
      conversationId: string;
      /** A turn nobody is watching: the bubble never takes it for the person's own question. */
      background?: true | undefined;
    }
  | { type: 'turn.delta'; turnId: string; text: string }
  | {
      type: 'turn.toolRequest';
      turnId: string;
      approvalId: string;
      callId?: string | undefined;
      tool: string;
      input: unknown;
    }
  | {
      type: 'turn.toolResult';
      turnId: string;
      callId?: string | undefined;
      tool: string;
      ok: boolean;
      summary: string;
    }
  | { type: 'turn.completed'; turnId: string; text: string; stopReason: StopReason }
  | { type: 'turn.error'; turnId: string; code: string; message: string }
  // A warning leaves the turn running: it still answers, unlike an error.
  | { type: 'turn.warning'; turnId: string; code: string; message: string }
  | ({ type: 'connector.confirm' } & ConnectorConfirmParams)
  | ({ type: 'connector.dismiss' } & ConnectorDismissParams)
  | ({ type: 'pet.remark' } & PetRemarkParams)
  // The brain only says the apps changed; the page reads the list again.
  | { type: 'connections.changed' };
