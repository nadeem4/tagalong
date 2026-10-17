/**
 * Point, don't click: a ring the host draws around one thing on screen, so "where's the
 * export button?" gets a place as well as words. The host only draws; nothing is moved,
 * pressed or typed. `read`, because it leaves nothing stored behind.
 * Contains `pointAtTool`.
 */
import { POINT_LABEL_MAX, ScreenPointAtParams } from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import type { PerceptionHost } from '../../perception/host';
import { defineTool, type Tool, type ToolOutcome } from '../tool';
import { hostFailure, noHost } from './perception';

export const POINT_AT = 'point_at';

export interface PointingDeps {
  /** Called per use: hosts connect and drop while a conversation is in flight. */
  hosts: () => readonly PerceptionHost[];
}

const LABEL = {
  type: 'string',
  description: `A short label beside the ring, up to ${POINT_LABEL_MAX} characters.`,
};

const DEFINITION: BrainTool = {
  name: POINT_AT,
  description:
    'Show the person where something is: a soft ring with a short label appears around it ' +
    'on their screen for a few seconds. Prefer naming the element: give a windowId from ' +
    'list_windows and the exact name of the button, menu or field as it reads on screen. ' +
    'Only for something a picture alone shows, give a displayId and a rect in that ' +
    "display's own pixels, as look_closer takes. Give one pair or the other, never both.",
  // One flat object: the provider APIs refuse oneOf/anyOf/allOf at the top of a tool schema.
  // "Exactly one of the two pairs" is enforced when the call is parsed (paramsOf).
  inputSchema: {
    type: 'object',
    properties: {
      windowId: {
        type: 'string',
        description: 'A window id from list_windows. Goes with name.',
      },
      name: {
        type: 'string',
        description: 'The element’s name as it reads on screen. Goes with windowId.',
      },
      displayId: {
        type: 'number',
        description: 'A display id from list_displays. Goes with rect, instead of windowId.',
      },
      rect: {
        type: 'object',
        description: "In that display's own pixels. Goes with displayId.",
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['x', 'y', 'width', 'height'],
      },
      label: LABEL,
    },
    additionalProperties: false,
  },
};

export function pointAtTool(deps: PointingDeps): Tool {
  return defineTool(DEFINITION, 'read', (input, _ctx) => pointAt(deps, input));
}

async function pointAt(deps: PointingDeps, input: unknown): Promise<ToolOutcome> {
  const params = paramsOf(input);
  if (params === undefined) {
    return {
      content:
        `${POINT_AT} needs either a windowId and the element's name, or a displayId and a ` +
        'rect with a positive width and height. Not both.',
      isError: true,
    };
  }

  const host = deps
    .hosts()
    .find(
      (candidate) =>
        candidate.capabilities.includes('pointer') && typeof candidate.pointAt === 'function',
    );
  if (host?.pointAt === undefined) return noHost('point at things on screen');

  try {
    const answer = await host.pointAt(params);
    if (answer.blocked !== undefined) {
      return {
        content:
          `That window is on the capture exclusion list (${answer.blocked.entry}), so nothing in ` +
          'it was read and nothing was shown.',
        isError: true,
      };
    }
    if (!answer.shown) {
      const why = (answer.notes ?? []).join(' ') || 'Nothing was shown.';
      return { content: why, isError: true };
    }
    const what =
      params.label === undefined || params.label === '' ? 'that spot' : `'${params.label}'`;
    const where = answer.screen === undefined ? '' : ` on screen ${answer.screen}`;
    return {
      content:
        `Pointing at ${what}${where}. The ring fades by itself in a few seconds.`,
    };
  } catch (error) {
    return hostFailure(error);
  }
}

/** The model's input as one of the two shapes, its label cut to fit; undefined if neither. */
function paramsOf(input: unknown): ScreenPointAtParams | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const asked = { ...(input as Record<string, unknown>) };
  if (typeof asked['label'] === 'string') {
    asked['label'] = asked['label'].slice(0, POINT_LABEL_MAX);
  } else if (typeof asked['name'] === 'string') {
    asked['label'] = asked['name'].slice(0, POINT_LABEL_MAX);
  } else {
    delete asked['label'];
  }
  // A model may send fractional pixels; whole ones are what a display has.
  const rect = asked['rect'];
  if (typeof rect === 'object' && rect !== null) {
    asked['rect'] = Object.fromEntries(
      Object.entries(rect).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value) : value,
      ]),
    );
  }
  const parsed = ScreenPointAtParams.safeParse(asked);
  return parsed.success ? parsed.data : undefined;
}
