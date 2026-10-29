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

  // Turns the brain started on its own (a wake). They show nothing while they run: a silent
  // wake must leave no trace, and one with words arrives as a single pet.remark at the end.
  const quiet = new Set<string>();

  function ended(p: TurnParams): TurnEvent[] {
    const text = open.get(p.turn) ?? '';
    open.delete(p.turn);
    if (quiet.delete(p.turn)) {
      if (p.reason !== 'done' || text.trim() === '') return [];
      return [{ type: 'pet.remark', remarkId: crypto.randomUUID(), petId: petId(), text }];
    }
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
    if (quiet.has(p.turn)) return [];
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
    // The wire is not validated here, so a frame with no id or options is no ask at all.
    if (p.state !== 'open' || typeof p.id !== 'string' || !Array.isArray(p.options)) return [];
    // A tool-gate ask is a confirm; a job's ask (no confirm) is a hand-off or relayed permission
    // when it has a tool, and a question for the person when it has none.
    const question = !p.confirm && p.tool === undefined;
    const tool = p.tool ?? 'question';
    const input = Object.entries(p.input ?? {}).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    );
    // Scout's own words lead; with none, the tool and what it was given stand in. A job's ask
    // keeps its input beside the words: the hand-off's folder is only there.
    const lead = p.text !== '' ? p.text : question ? 'Claude Code asks' : tool;
    const summary =
      p.confirm && p.text !== '' ? p.text : [lead, ...input].filter((s) => s !== '').join('\n');
    // Body tools arrive as `<body>__<name>`; a name without it is the brain's own.
    const body = tool.includes('__') ? tool.split('__')[0]! : '';
    const app =
      question || tool.startsWith('claude_code:')
        ? 'Claude Code'
        : body === ''
          ? 'Scout'
          : body.charAt(0).toUpperCase() + body.slice(1);
    asks.add(p.id);
    return [
      {
        type: 'connector.confirm',
        approvalId: p.id,
        turnId: p.turn ?? '',
        petId: petId(),
        app,
        tool,
        summary,
        options: p.options,
        ...(question ? { question: true } : {}),
      },
    ];
  }

  return {
    map(method: string, params: unknown): TurnEvent[] {
      if (method === 'turn') {
        const p = params as TurnParams;
        if (p.state === 'ended') return ended(p);
        open.set(p.turn, '');
        if (p.started_by === 'brain') {
          quiet.add(p.turn);
          return [];
        }
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
        return quiet.has(p.turn) ? [] : [{ type: 'turn.delta', turnId: p.turn, text: p.delta }];
      }
      if (method === 'tool') return tool(params as ToolParams);
      if (method === 'ask') return ask(params as AskParams);
      return [];
    },

    /**
     * The person spoke into a wake turn (their say joined it), so it stops being quiet: the UI
     * gets the start and the words so far, and the rest streams like any turn.
     */
    claim(turnId: string): TurnEvent[] {
      if (!quiet.delete(turnId)) return [];
      const text = open.get(turnId) ?? '';
      return [
        { type: 'turn.started', turnId, petId: petId(), conversationId: session() ?? 'brain' },
        ...(text === '' ? [] : [{ type: 'turn.delta' as const, turnId, text }]),
      ];
    },

    /** The brain lost what these turns were doing; tell the UI instead of leaving them open. */
    resync(): TurnEvent[] {
      const events = [...open.keys()]
        .filter((id) => !quiet.has(id))
        .map((id) => error(id, 'brain_restarted', LOST_MESSAGE));
      open.clear();
      quiet.clear();
      for (const id of asks) events.push(dismiss(id));
      asks.clear();
      return events;
    },
  };
}
