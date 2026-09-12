import { describe, expect, it } from 'vitest';
import type { CaptureExclusions, ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import {
  GET_SELECTION,
  LOOK_AT_SCREEN,
  createPerceptionToolset,
  type PerceptionHost,
  type ToolOutcome,
} from './tools';

/**
 * Asserts the result is prose before reading it as prose. `content` widened to blocks when
 * look_at_screen learned to return pixels; on these paths words are the contract, so a
 * block array is a failure to report, not a shape to coerce past.
 */
function asText(content: ToolOutcome['content']): string {
  if (typeof content !== 'string') throw new Error(`expected a text tool result, got blocks`);
  return content;
}

const NO_EXCLUSIONS: CaptureExclusions = { processNames: [], titlePatterns: [] };

const PNG = 'iVBORw0KGgo=';

/** A host that answers capture from a canned patch and records what it was asked for. */
function fakeHost(
  capabilities: PerceptionHost['capabilities'],
  patch: ContextSnapshotPatch,
): PerceptionHost & { asked: PerceptionTarget[][] } {
  const asked: PerceptionTarget[][] = [];
  return {
    capabilities,
    asked,
    capture(what) {
      asked.push([...what]);
      const wanted = new Set(what);
      return Promise.resolve({
        ...(wanted.has('activeWindow') && patch.app ? { app: patch.app } : {}),
        ...(wanted.has('screenshot') && patch.screenshot ? { screenshot: patch.screenshot } : {}),
        ...(wanted.has('selection') && patch.selection !== undefined
          ? { selection: patch.selection }
          : {}),
      });
    },
  };
}

function toolset(
  hosts: readonly PerceptionHost[],
  exclusions: CaptureExclusions = NO_EXCLUSIONS,
  vision = true,
): ReturnType<typeof createPerceptionToolset> {
  return createPerceptionToolset({
    hosts: () => hosts,
    exclusions: () => exclusions,
    vision: () => vision,
  });
}

function screenshotHost(): ReturnType<typeof fakeHost> {
  return fakeHost(['screenshot', 'activeWindow'], {
    app: { name: 'notepad.exe', windowTitle: 'budget.txt' },
    screenshot: { mime: 'image/png', base64: PNG, width: 800, height: 600 },
  });
}

describe('perception tool definitions', () => {
  it('offers exactly look_at_screen and get_selection', () => {
    expect(toolset([]).definitions.map((tool) => tool.name)).toEqual([
      LOOK_AT_SCREEN,
      GET_SELECTION,
    ]);
  });

  it('describes each tool so a model knows when to reach for it', () => {
    for (const tool of toolset([]).definitions) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema['type']).toBe('object');
    }
  });
});

describe('look_at_screen', () => {
  it('hands back the captured PNG itself, so a seeing model can read the screen', async () => {
    const host = screenshotHost();

    const result = await toolset([host]).run({ name: LOOK_AT_SCREEN });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'image', mime: 'image/png', base64: PNG },
      { type: 'text', text: expect.stringContaining('budget.txt') },
    ]);
  });

  it('describes the capture in words when the provider has no vision', async () => {
    const host = screenshotHost();

    const result = await toolset([host], NO_EXCLUSIONS, false).run({ name: LOOK_AT_SCREEN });

    expect(result.isError).toBeFalsy();
    expect(typeof result.content).toBe('string');
    expect(result.content).toContain('budget.txt');
    expect(result.content).toContain('800');
    expect(result.content).toContain('600');
    // A blind model must never be handed base64: unreadable, enormous, and billed for.
    expect(result.content).not.toContain(PNG);
    // It has to be able to say why it cannot answer instead of inventing a description.
    expect(String(result.content).toLowerCase()).toContain('cannot look at images');
  });

  it('assumes no vision when the caller does not say, so pixels are never sent blind', async () => {
    const host = screenshotHost();
    const blind = createPerceptionToolset({
      hosts: () => [host],
      exclusions: () => NO_EXCLUSIONS,
    });

    const result = await blind.run({ name: LOOK_AT_SCREEN });

    expect(typeof result.content).toBe('string');
  });

  it('asks the host for the active window before it asks for pixels', async () => {
    const host = fakeHost(['screenshot', 'activeWindow'], {
      app: { name: 'notepad.exe' },
      screenshot: { mime: 'image/png', base64: PNG, width: 10, height: 10 },
    });

    await toolset([host]).run({ name: LOOK_AT_SCREEN });

    expect(host.asked[0]).toEqual(['activeWindow']);
    expect(host.asked[1]).toEqual(['screenshot']);
  });

  it('refuses without capturing when the active window is excluded', async () => {
    const host = fakeHost(['screenshot', 'activeWindow'], {
      app: { name: '1Password.exe', windowTitle: '1Password' },
      screenshot: { mime: 'image/png', base64: PNG, width: 10, height: 10 },
    });

    const result = await toolset([host], {
      processNames: ['1password.exe'],
      titlePatterns: [],
    }).run({ name: LOOK_AT_SCREEN });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('blocked');
    expect(result.content).toContain('1password.exe');
    expect(result.content).not.toContain(PNG);
    expect(host.asked).toEqual([['activeWindow']]);
  });

  it('says so plainly when no connected host can take a screenshot', async () => {
    const host = fakeHost(['selection'], { selection: 'anything' });

    const result = await toolset([host]).run({ name: LOOK_AT_SCREEN });

    expect(result.isError).toBe(true);
    expect(asText(result.content).toLowerCase()).toContain('cannot');
    expect(host.asked).toEqual([]);
  });

  it('reports a host failure instead of hanging on it', async () => {
    const host: PerceptionHost = {
      capabilities: ['screenshot'],
      capture: () => Promise.reject(new Error('host did not answer perception.capture')),
    };

    const result = await toolset([host]).run({ name: LOOK_AT_SCREEN });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('host did not answer perception.capture');
  });
});

describe('get_selection', () => {
  it('returns the selected text the host reported', async () => {
    const host = fakeHost(['selection', 'activeWindow'], {
      app: { name: 'chrome.exe', windowTitle: 'Quarterly report' },
      selection: 'revenue fell 4% in Q3',
    });

    const result = await toolset([host]).run({ name: GET_SELECTION });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('revenue fell 4% in Q3');
  });

  it('says there is no selection rather than returning nothing', async () => {
    const host = fakeHost(['selection'], {});

    const result = await toolset([host]).run({ name: GET_SELECTION });

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(asText(result.content).toLowerCase()).toContain('nothing');
  });

  it('honours the exclusion list too, because selected text is as private as pixels', async () => {
    const host = fakeHost(['selection', 'activeWindow'], {
      app: { name: 'explorer.exe', windowTitle: 'Windows Security' },
      selection: 'a password',
    });

    const result = await toolset([host], {
      processNames: [],
      titlePatterns: ['*Windows Security*'],
    }).run({ name: GET_SELECTION });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('blocked');
    expect(result.content).not.toContain('a password');
  });
});

describe('unknown tools', () => {
  it('are refused by name rather than silently ignored', async () => {
    const result = await toolset([]).run({ name: 'delete_everything' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('delete_everything');
  });
});
