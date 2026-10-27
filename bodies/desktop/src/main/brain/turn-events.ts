/**
 * Turns the brain's notifications into the TurnEvents the renderer already understands, so
 * the UI needs no change when the brain moves to Python. Stateful: `turn.completed` carries
 * the whole reply, but the brain streams it, so the mapper keeps each open turn's text.
 */
import type { AskParams, ReplyParams, ToolParams, TurnParams } from '@tagalong/contract';
import type { TurnEvent } from '@tagalong/ui';

const BUDGET_MESSAGE = "Scout has used today's budget. It starts again tomorrow.";
const ERROR_MESSAGE = "Scout's brain hit a problem with that one. Try again?";
const LOST_MESSAGE = 'Scout lost the thread there. Ask again?';

const STOP_REASON = { done: 'end', cancelled: 'aborted', step_cap: 'tool_limit' } as const;

export function createTurnEvents(petId: () => string, session: () => string | null = () => null) {
  // Insertion order is start order, which resync() reports in.
  const open = new Map<string, string>();

  const error = (turnId: string, code: string, message: string): TurnEvent => ({
    type: 'turn.error',
    turnId,
    code,
    message,
  });

  function ended(p: TurnParams): TurnEvent[] {
    const text = open.get(p.turn) ?? '';
    open.delete(p.turn);
    if (p.reason === 'over_budget') return [error(p.turn, 'over_budget', BUDGET_MESSAGE)];
    if (p.reason === 'error') return [error(p.turn, 'brain_error', ERROR_MESSAGE)];
    const stopReason =
      STOP_REASON[p.reason === 'cancelled' || p.reason === 'step_cap' ? p.reason : 'done'];
    return [
      {
        type: 'turn.completed',
        turnId: p.turn,
        text,
        stopReason,
        // The contract carries no token counts; the UI only needs the field to exist.
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ];
  }

  function tool(p: ToolParams): TurnEvent[] {
    if (p.state === 'started') {
      // The brain runs its own tools and asks nobody, so the call id stands in for the
      // approval id and there is no input to show.
      return [
        {
          type: 'turn.toolRequest',
          turnId: p.turn,
          approvalId: p.call,
          callId: p.call,
          tool: p.name,
          input: {},
        },
      ];
    }
    return [
      {
        type: 'turn.toolResult',
        turnId: p.turn,
        callId: p.call,
        tool: p.name,
        ok: p.ok ?? true,
        summary: p.summary ?? '',
      },
    ];
  }

  // Ids of the confirm cards shown, so a closed frame only dismisses a card that was shown.
  // The dismissal is its own event, not asks.changed: Home counts and lists those from the
  // old engine, which knows nothing of the brain's asks.
  const asks = new Set<string>();

  const dismiss = (approvalId: string): TurnEvent => ({ type: 'connector.dismiss', approvalId });

  function ask(p: AskParams): TurnEvent[] {
    if (p.state === 'closed') return asks.delete(p.id) ? [dismiss(p.id)] : [];
    if (!p.confirm || p.tool === undefined) return [];
    const input = Object.entries(p.input ?? {}).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    );
    // Scout's own words lead; with none, the tool and what it was given stand in.
    const summary = p.text !== '' ? p.text : [p.tool, ...input].join('\n');
    // Body tools arrive as `<body>__<name>`; a name without it is the brain's own.
    const body = p.tool.includes('__') ? p.tool.split('__')[0]! : '';
    const app = body === '' ? 'Scout' : body.charAt(0).toUpperCase() + body.slice(1);
    asks.add(p.id);
    return [
      {
        type: 'connector.confirm',
        approvalId: p.id,
        turnId: p.turn ?? '',
        petId: petId(),
        app,
        tool: p.tool,
        summary,
        options: p.options,
      },
    ];
  }

  return {
    map(method: string, params: unknown): TurnEvent[] {
      if (method === 'turn') {
        const p = params as TurnParams;
        if (p.state === 'ended') return ended(p);
        open.set(p.turn, '');
        return [
          {
            type: 'turn.started',
            turnId: p.turn,
            petId: petId(),
            conversationId: session() ?? 'brain',
          },
        ];
      }
      if (method === 'reply') {
        const p = params as ReplyParams;
        if (typeof p.delta !== 'string') return [];
        open.set(p.turn, (open.get(p.turn) ?? '') + p.delta);
        return [{ type: 'turn.delta', turnId: p.turn, text: p.delta }];
      }
      if (method === 'tool') return tool(params as ToolParams);
      if (method === 'ask') return ask(params as AskParams);
      return [];
    },

    /** The brain lost what these turns were doing; tell the UI instead of leaving them open. */
    resync(): TurnEvent[] {
      const events = [...open.keys()].map((id) => error(id, 'brain_restarted', LOST_MESSAGE));
      open.clear();
      for (const id of asks) events.push(dismiss(id));
      asks.clear();
      return events;
    },
  };
}
