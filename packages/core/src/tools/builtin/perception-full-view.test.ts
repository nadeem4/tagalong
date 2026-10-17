/** Tests for the display and window tools: definitions, input checks and host refusals. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_TEXT_CHARS } from '@tagalong/protocol';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { BrainContentBlock } from '../../providers';
import type { PerceptionHost } from '../../perception/host';
import { fakeTurnTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import type { TurnTools } from '../registry';
import type { ToolOutcome } from '../tool';
import {
  GET_SELECTION,
  LIST_DISPLAYS,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_AT_SCREEN,
  LOOK_AT_WINDOW,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
} from './perception';

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
  captureWindow: Array<{ windowId: string; maxLongSide: number }>;
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
  const calls: FullViewCalls = {
    captureRegion: [],
    listWindows: 0,
    readText: [],
    captureWindow: [],
  };
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
    captureWindow: (params) => {
      calls.captureWindow.push(params);
      return Promise.resolve({ windowId: params.windowId, image: IMAGE });
    },
  };
}

function toolset(
  hosts: readonly PerceptionHost[],
  vision = true,
  windowTextBudget?: () => number,
): TurnTools {
  return fakeTurnTools(
    {
      perception: {
        hosts: () => hosts,
        exclusions: () => NO_EXCLUSIONS,
        ...(windowTextBudget === undefined ? {} : { windowTextBudget }),
      },
    },
    { vision },
  );
}

describe('the full-view toolset', () => {
  it('offers the five full-view tools after the Phase 2 pair, then the Phase 3B pair, then point_at', () => {
    expect(toolset([fullViewHost()]).definitions.map((tool) => tool.name)).toEqual([
      LOOK_AT_SCREEN,
      GET_SELECTION,
      LIST_DISPLAYS,
      LOOK_AT_DISPLAY,
      LOOK_CLOSER,
      LIST_WINDOWS,
      READ_WINDOW_TEXT,
      LOOK_AT_WINDOW,
      'recall_screen',
      'what_changed',
      'point_at',
    ]);
  });

  it('has no tool that reads every window at once', () => {
    // Reading every window costs about 11,600 tokens on a twelve-window desktop, so no
    // tool may do it. A tool taking an array of window ids, or named for "all", would
    // reopen it quietly.
    for (const tool of toolset([fullViewHost()]).definitions) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(/"type":\s*"array"/);
      // Whole words only: `recall_screen` has "all" inside "recall" and reads nothing.
      expect(tool.name).not.toMatch(/(^|_)(all|every)(_|$)/i);
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
    expect(asText(result.content).toLowerCase()).toContain('the picture was not seen');
    expect(directivesIn(result.content)).toEqual([]);
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
    expect(directivesIn(result.content)).toEqual([]);
  });

  it('states that the host returned no picture of a display', async () => {
    const host = fullViewHost();
    const { id, bounds } = DISPLAY_ONE;
    const bare = { id, bounds, scaleFactor: 1, primary: true, focused: true };
    host.capture = () => Promise.resolve({ displays: [bare], composite: IMAGE });
    const result = await toolset([host]).run({
      name: LOOK_AT_DISPLAY,
      input: { displayId: DISPLAY_ONE.id },
    });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('no picture');
    expect(directivesIn(result.content)).toEqual([]);
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

  it('groups windows by screen number when the host names its screens, without a picture', async () => {
    // "What do you see?" is answered from this list alone, so it has to say which screen
    // each window is on in the numbers the user and the composite use, not Electron ids.
    let captured = 0;
    const host: PerceptionHost = {
      ...fullViewHost(),
      capture: () => {
        captured += 1;
        return Promise.resolve({});
      },
      listWindows: () =>
        Promise.resolve({
          windows: [WINDOW_EDITOR, WINDOW_BROWSER],
          displays: [DISPLAY_ONE, DISPLAY_TWO].map(({ id, bounds, primary }) => ({
            id,
            bounds,
            primary,
          })),
        }),
    };
    const text = asText((await toolset([host]).run({ name: LIST_WINDOWS })).content);

    expect(text).toContain('Screen 1');
    expect(text).toContain('Screen 2');
    expect(text.indexOf('w-1')).toBeLessThan(text.indexOf('Screen 2'));
    expect(text.indexOf('w-2')).toBeGreaterThan(text.indexOf('Screen 2'));
    expect(text).not.toContain('2528732444');
    expect(captured).toBe(0);
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

  it('falls back to the budget the user configured, not the shipped default', async () => {
    const host = fullViewHost();
    await toolset([host], true, () => 3_000).run({
      name: READ_WINDOW_TEXT,
      input: { windowId: 'w-1' },
    });
    expect(host.calls.readText[0]?.maxChars).toBe(3_000);
  });

  it('reads the configured budget per call, so a settings edit needs no restart', async () => {
    // The lookup is a function for the same reason the exclusion list is: the user edits
    // this while the app runs, and a value captured at boot would be a setting that
    // silently does nothing until the next launch.
    const host = fullViewHost();
    let budget = 3_000;
    const tools = toolset([host], true, () => budget);

    await tools.run({ name: READ_WINDOW_TEXT, input: { windowId: 'w-1' } });
    budget = 9_000;
    await tools.run({ name: READ_WINDOW_TEXT, input: { windowId: 'w-1' } });

    expect(host.calls.readText.map((call) => call.maxChars)).toEqual([3_000, 9_000]);
  });

  it('still lets the pet ask for less than the configured budget', async () => {
    const host = fullViewHost();
    await toolset([host], true, () => 9_000).run({
      name: READ_WINDOW_TEXT,
      input: { windowId: 'w-1', maxChars: 500 },
    });
    expect(host.calls.readText[0]?.maxChars).toBe(500);
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
    expect(directivesIn(result.content)).toEqual([]);
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
      expect(directivesIn(result.content), name).toEqual([]);
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

describe('the read_window_text description', () => {
  it('does not name a character count the user can change underneath it', () => {
    // The definitions are built once at module load, so any number written into this
    // description is the shipped default forever — and tells the model something false
    // the moment the budget is raised in Settings.
    const tool = toolset([fullViewHost()]).definitions.find(
      (candidate) => candidate.name === READ_WINDOW_TEXT,
    );
    expect(tool).toBeDefined();
    // The whole definition, because the number would live in the maxChars property
    // description rather than the tool's own, and the model reads both.
    const wording = JSON.stringify(tool).toLowerCase();
    expect(wording).not.toMatch(/\b\d{3,}\b/);
    expect(wording).toContain('settings');
  });
});

describe('look_at_window', () => {
  it('photographs one listed window, even one behind others, and hands back the pixels', async () => {
    const host = fullViewHost();
    const result = await toolset([host]).run({ name: LOOK_AT_WINDOW, input: { windowId: 'w-1' } });

    expect(host.calls.captureWindow).toEqual([{ windowId: 'w-1', maxLongSide: 1568 }]);
    const blocks = imageBlocks(result.content);
    expect(blocks[0]).toEqual({ type: 'image', mime: 'image/png', base64: PNG });
  });

  it('needs a window id', async () => {
    const result = await toolset([fullViewHost()]).run({ name: LOOK_AT_WINDOW, input: {} });
    expect(result.isError).toBe(true);
    expect(asText(result.content)).toMatch(/list_windows/);
  });

  it('repeats why there is no picture: a blind spot, or a minimized window', async () => {
    const host = fullViewHost();
    host.captureWindow = (params) =>
      Promise.resolve({
        windowId: params.windowId,
        blocked: { rule: 'titlePattern', entry: '.env' },
        notes: ['This window is a blind spot.'],
      });

    const result = await toolset([host]).run({ name: LOOK_AT_WINDOW, input: { windowId: 'w-1' } });

    expect(result.isError).toBe(true);
    expect(asText(result.content)).toContain('This window is a blind spot.');
  });

  it('says it cannot see images rather than pretending to', async () => {
    const result = await toolset([fullViewHost()], false).run({
      name: LOOK_AT_WINDOW,
      input: { windowId: 'w-1' },
    });
    expect(asText(result.content)).toMatch(/cannot see images/);
    expect(directivesIn(result.content)).toEqual([]);
  });

  it('states that a blind pet did not see a closer look', async () => {
    const result = await toolset([fullViewHost()], false).run({
      name: LOOK_CLOSER,
      input: { displayId: 77, rect: { x: 0, y: 0, width: 40, height: 40 } },
    });
    expect(asText(result.content)).toMatch(/cannot see images/);
    expect(directivesIn(result.content)).toEqual([]);
  });
});
