import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_TEXT_CHARS } from '@tagalong/protocol';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { BrainContentBlock } from '../providers';
import {
  GET_SELECTION,
  LIST_DISPLAYS,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_AT_SCREEN,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
  createPerceptionToolset,
  type PerceptionHost,
  type ToolOutcome,
} from './tools';

const NO_EXCLUSIONS: CaptureExclusions = { processNames: [], titlePatterns: [] };
const PNG = 'iVBORw0KGgo=';

function asText(content: ToolOutcome['content']): string {
  if (typeof content !== 'string') throw new Error('expected a text tool result, got blocks');
  return content;
}

function imageBlocks(content: ToolOutcome['content']): BrainContentBlock[] {
  if (typeof content === 'string') throw new Error(`expected blocks, got text: ${content}`);
  return content;
}

const IMAGE = { mime: 'image/png' as const, base64: PNG, width: 1568, height: 882 };

const DISPLAY_ONE = {
  id: 2528732444,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: true,
  focused: true,
  image: IMAGE,
};
const DISPLAY_TWO = {
  id: 77,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: false,
  focused: false,
  image: IMAGE,
};

const WINDOW_EDITOR = {
  id: 'w-1',
  processName: 'Code.exe',
  title: 'displays.ts — tagalong',
  displayId: 2528732444,
  state: 'background' as const,
  browser: false,
  textChars: 4000,
};
const WINDOW_BROWSER = {
  id: 'w-2',
  processName: 'chrome.exe',
  title: 'Tagalong — Notion',
  displayId: 77,
  state: 'foreground' as const,
  browser: true,
  textChars: 34000,
};

interface FullViewCalls {
  captureRegion: Array<{ displayId: number; rect: unknown; maxLongSide: number }>;
  listWindows: number;
  readText: Array<{ windowId?: string; maxChars: number }>;
}

/** A host answering the three full-view methods, recording exactly what it was asked. */
function fullViewHost(
  capabilities: PerceptionHost['capabilities'] = [
    'screenshot',
    'activeWindow',
    'displays',
    'textLayer',
  ],
): PerceptionHost & { calls: FullViewCalls } {
  const calls: FullViewCalls = { captureRegion: [], listWindows: 0, readText: [] };
  return {
    capabilities,
    calls,
    capture: () => Promise.resolve({ displays: [DISPLAY_ONE, DISPLAY_TWO], composite: IMAGE }),
    captureRegion: (params) => {
      calls.captureRegion.push(params);
      return Promise.resolve({
        image: { mime: 'image/png' as const, base64: PNG, width: 640, height: 480 },
      });
    },
    listWindows: () => {
      calls.listWindows += 1;
      return Promise.resolve({ windows: [WINDOW_EDITOR, WINDOW_BROWSER] });
    },
    readText: (params) => {
      calls.readText.push(params);
      return Promise.resolve({
        windowId: params.windowId ?? 'w-1',
        text: 'error TS2532: Object is possibly undefined',
        truncated: false,
        source: 'uia' as const,
      });
    },
  };
}

function toolset(
  hosts: readonly PerceptionHost[],
  vision = true,
): ReturnType<typeof createPerceptionToolset> {
  return createPerceptionToolset({
    hosts: () => hosts,
    exclusions: () => NO_EXCLUSIONS,
    vision: () => vision,
  });
}

describe('the full-view toolset', () => {
  it('offers exactly the five full-view tools alongside the Phase 2 pair', () => {
    expect(toolset([fullViewHost()]).definitions.map((tool) => tool.name)).toEqual([
      LOOK_AT_SCREEN,
      GET_SELECTION,
      LIST_DISPLAYS,
      LOOK_AT_DISPLAY,
      LOOK_CLOSER,
      LIST_WINDOWS,
      READ_WINDOW_TEXT,
    ]);
  });

  it('has no tool that reads every window at once', () => {
    // The whole cost argument of this phase rests on this absence. Measured on a
    // twelve-window desktop, reading everything is ~11,600 tokens in a single call. A
    // tool taking an array of window ids, or named for "all", would reopen it quietly.
    for (const tool of toolset([fullViewHost()]).definitions) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(/"type":\s*"array"/);
      expect(tool.name).not.toMatch(/all|every/i);
    }
  });

  it('tells the pet to read the inventory before reaching for text', () => {
    const read = toolset([fullViewHost()]).definitions.find(
      (tool) => tool.name === READ_WINDOW_TEXT,
    );
    expect(read?.description).toContain(LIST_WINDOWS);
  });

  it('tells the pet not to use look_closer to read text', () => {
    const closer = toolset([fullViewHost()]).definitions.find((tool) => tool.name === LOOK_CLOSER);
    expect(closer?.description).toContain(READ_WINDOW_TEXT);
  });
});

describe(LIST_DISPLAYS, () => {
  it('names every display with its geometry, and no pixels', async () => {
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_DISPLAYS })).content);
    expect(text).toContain('2528732444');
    expect(text).toContain('77');
    expect(text).toContain('1920');
    expect(text).not.toContain(PNG);
  });

  it('says which display is focused', async () => {
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_DISPLAYS })).content);
    expect(text.toLowerCase()).toContain('focused');
  });
});

describe(LOOK_AT_DISPLAY, () => {
  it('returns that display as an image block, not base64 text', async () => {
    const result = await toolset([fullViewHost()]).run({
      name: LOOK_AT_DISPLAY,
      input: { displayId: 77 },
    });
    expect(imageBlocks(result.content).some((block) => block.type === 'image')).toBe(true);
  });

  it('tells a blind pet it cannot see, rather than narrating pixels it never got', async () => {
    const result = await toolset([fullViewHost()], false).run({
      name: LOOK_AT_DISPLAY,
      input: { displayId: 77 },
    });
    expect(asText(result.content).toLowerCase()).toContain('cannot look at images');
  });

  it('reports a display id that is not there instead of guessing one', async () => {
    const result = await toolset([fullViewHost()]).run({
      name: LOOK_AT_DISPLAY,
      input: { displayId: 999 },
    });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('999');
  });

  it('refuses a blocked display and names the rule', async () => {
    const host = fullViewHost();
    host.capture = () =>
      Promise.resolve({
        displays: [
          {
            ...DISPLAY_ONE,
            blocked: { rule: 'processName' as const, entry: '1Password.exe' },
          },
        ],
        composite: IMAGE,
      });
    const result = await toolset([host]).run({
      name: LOOK_AT_DISPLAY,
      input: { displayId: DISPLAY_ONE.id },
    });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('1Password.exe');
  });
});

describe(LOOK_CLOSER, () => {
  it('calls captureRegion with the rectangle it was given', async () => {
    const host = fullViewHost();
    await toolset([host]).run({
      name: LOOK_CLOSER,
      input: { displayId: 77, rect: { x: 100, y: 200, width: 640, height: 480 } },
    });
    expect(host.calls.captureRegion).toHaveLength(1);
    expect(host.calls.captureRegion[0]?.displayId).toBe(77);
    expect(host.calls.captureRegion[0]?.rect).toEqual({ x: 100, y: 200, width: 640, height: 480 });
  });

  it('returns the crop as an image block', async () => {
    const result = await toolset([fullViewHost()]).run({
      name: LOOK_CLOSER,
      input: { displayId: 77, rect: { x: 0, y: 0, width: 640, height: 480 } },
    });
    expect(imageBlocks(result.content).some((block) => block.type === 'image')).toBe(true);
  });

  it('rejects a rectangle with no area instead of asking the host for nothing', async () => {
    const host = fullViewHost();
    const result = await toolset([host]).run({
      name: LOOK_CLOSER,
      input: { displayId: 77, rect: { x: 0, y: 0, width: 0, height: 480 } },
    });
    expect(result.isError).toBe(true);
    expect(host.calls.captureRegion).toHaveLength(0);
  });
});

describe(LIST_WINDOWS, () => {
  it('lists every window with its process, state and display', async () => {
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_WINDOWS })).content);
    // The renderer drops `.exe` and abbreviates the state, both to keep the inventory
    // inside its token budget; the legend line is what carries the long forms.
    expect(text).toContain('Code');
    expect(text).toContain('w-1');
    expect(text).toContain('background');
  });

  it('never returns window text, only what and where', async () => {
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_WINDOWS })).content);
    expect(text).not.toContain('error TS2532');
  });

  it('says a browser window covers its active tab only', async () => {
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_WINDOWS })).content);
    expect(text.toLowerCase()).toContain('tab');
  });

  it('presents the character count as approximate, never as exact', async () => {
    // textChars is a floor: each window gets a 400ms walk budget, so a window really
    // holding 35k characters reports far less. A result calling it a total would have the
    // pet reason from a number wrong by an order of magnitude.
    const text = asText((await toolset([fullViewHost()]).run({ name: LIST_WINDOWS })).content);
    expect(text.toLowerCase()).toMatch(/approx|about|at least|roughly/);
  });
});

describe(READ_WINDOW_TEXT, () => {
  it('reads the window it was named', async () => {
    const host = fullViewHost();
    await toolset([host]).run({ name: READ_WINDOW_TEXT, input: { windowId: 'w-2' } });
    expect(host.calls.readText[0]?.windowId).toBe('w-2');
  });

  it('reads the foreground window when none is named', async () => {
    const host = fullViewHost();
    await toolset([host]).run({ name: READ_WINDOW_TEXT, input: {} });
    expect(host.calls.readText[0]?.windowId).toBeUndefined();
  });

  it('honours maxChars', async () => {
    const host = fullViewHost();
    await toolset([host]).run({
      name: READ_WINDOW_TEXT,
      input: { windowId: 'w-1', maxChars: 1200 },
    });
    expect(host.calls.readText[0]?.maxChars).toBe(1200);
  });

  it('defaults maxChars to the documented per-window budget', async () => {
    const host = fullViewHost();
    await toolset([host]).run({ name: READ_WINDOW_TEXT, input: { windowId: 'w-1' } });
    expect(host.calls.readText[0]?.maxChars).toBe(DEFAULT_WINDOW_TEXT_CHARS);
  });

  it('marks truncation so a cut-off line is not read as the end', async () => {
    const host = fullViewHost();
    host.readText = () =>
      Promise.resolve({
        windowId: 'w-1',
        text: 'x'.repeat(10),
        truncated: true,
        source: 'uia' as const,
      });
    const text = asText((await toolset([host]).run({ name: READ_WINDOW_TEXT })).content);
    expect(text.toLowerCase()).toContain('truncat');
  });

  it('passes the notes through, so the pet does not claim a window was empty', async () => {
    const host = fullViewHost();
    host.readText = () =>
      Promise.resolve({
        windowId: 'w-1',
        text: '',
        truncated: false,
        source: 'uia' as const,
        notes: ['Code published no text through the accessibility tree.'],
      });
    const text = asText((await toolset([host]).run({ name: READ_WINDOW_TEXT })).content);
    expect(text).toContain('accessibility tree');
  });

  it('refuses an excluded window and names the rule', async () => {
    const host = fullViewHost();
    host.readText = () =>
      Promise.resolve({
        windowId: 'w-1',
        text: '',
        truncated: false,
        source: 'uia' as const,
        blocked: { rule: 'processName' as const, entry: '1Password.exe' },
      });
    const result = await toolset([host]).run({ name: READ_WINDOW_TEXT });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('1Password.exe');
  });

  it('says OCR text may contain recognition errors', async () => {
    const host = fullViewHost();
    host.readText = () =>
      Promise.resolve({
        windowId: 'w-1',
        text: 'rn vs m',
        truncated: false,
        source: 'ocr' as const,
      });
    const text = asText((await toolset([host]).run({ name: READ_WINDOW_TEXT })).content);
    expect(text.toLowerCase()).toContain('recognition');
  });
});

describe('when no host can do it', () => {
  it('says so for each full-view tool rather than failing the turn', async () => {
    const plain = fullViewHost(['screenshot', 'activeWindow']);
    const input = { displayId: 77, rect: { x: 0, y: 0, width: 4, height: 4 } };
    for (const name of [
      LIST_DISPLAYS,
      LOOK_AT_DISPLAY,
      LOOK_CLOSER,
      LIST_WINDOWS,
      READ_WINDOW_TEXT,
    ]) {
      const result = await toolset([plain]).run({ name, input });
      expect(result.isError, name).toBe(true);
      expect(asText(result.content).toLowerCase(), name).toContain('no connected host');
    }
  });

  it('turns a host failure into a tool result, not a dead turn', async () => {
    const host = fullViewHost();
    host.listWindows = () => Promise.reject(new Error('socket closed'));
    const result = await toolset([host]).run({ name: LIST_WINDOWS });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('socket closed');
  });
});
