import { POINT_LABEL_MAX, ScreenPointAtParams } from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import type { PerceptionHost } from '../../perception/host';
import { defineTool, type Tool, type ToolOutcome } from '../tool';
import { hostFailure, noHost } from './perception';

/**
 * Point, don't click: a ring the host draws around one thing on screen, so "where's the
 * export button?" gets a place as well as words. The host only draws; nothing is moved,
 * pressed or typed. `read`, because it leaves nothing stored behind.
 */
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
    "display's own pixels, as look_closer takes. Say where it is in words too.",
  inputSchema: {
    type: 'object',
    oneOf: [
      {
        type: 'object',
        properties: {
          windowId: { type: 'string', description: 'A window id from list_windows.' },
          name: { type: 'string', description: 'The element’s name as it reads on screen.' },
          label: LABEL,
        },
        required: ['windowId', 'name'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          displayId: { type: 'number', description: 'A display id from list_displays.' },
          rect: {
            type: 'object',
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
        required: ['displayId', 'rect'],
        additionalProperties: false,
      },
    ],
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
          'it was read and nothing was shown. Tell the person you cannot see that window.',
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
        `Pointing at ${what}${where}. The ring fades by itself in a few ` +
        'seconds. Tell the person where it is in words too.',
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
