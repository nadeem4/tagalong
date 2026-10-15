import { describe, expect, it } from 'vitest';
import type { ScreenPointAtParams, ScreenPointAtResult } from '@tagalong/protocol';
import type { PerceptionHost } from '../../perception/host';
import { fakeTurnTools } from '../fake-turn';
import type { TurnTools } from '../registry';
import { POINT_AT } from './pointing';

const NO_EXCLUSIONS = { processNames: [], titlePatterns: [] };

/** A host that can point, answering with `answer` and keeping what it was asked. */
function pointer(
  answer: ScreenPointAtResult | Error = { shown: true, screen: 2 },
): PerceptionHost & { asked: ScreenPointAtParams[] } {
  const asked: ScreenPointAtParams[] = [];
  return {
    capabilities: ['pointer'],
    asked,
    capture: () => Promise.resolve({}),
    pointAt(params) {
      asked.push(params);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

function toolset(hosts: readonly PerceptionHost[]): TurnTools {
  return fakeTurnTools({ perception: { hosts: () => hosts, exclusions: () => NO_EXCLUSIONS } });
}

function text(content: unknown): string {
  if (typeof content !== 'string') throw new Error('expected text');
  return content;
}

describe(POINT_AT, () => {
  it('offers exactly one of two shapes: a named element in a window, or a display rectangle', () => {
    const definition = toolset([pointer()]).definitions.find((tool) => tool.name === POINT_AT);
    const schema = definition?.inputSchema as {
      oneOf?: Array<{ required?: string[] }>;
    };
    expect(schema.oneOf?.map((shape) => shape.required)).toEqual([
      ['windowId', 'name'],
      ['displayId', 'rect'],
    ]);
  });

  it('is a read tool: it leaves nothing stored behind', () => {
    const tool = toolset([pointer()]).tools.find((candidate) => candidate.id === POINT_AT);
    expect(tool?.kind).toBe('read');
  });

  it('asks the host to point at a named element and says where the ring is', async () => {
    const host = pointer({ shown: true, screen: 2 });
    const outcome = await toolset([host]).run({
      name: POINT_AT,
      input: { windowId: 'w-7', name: 'Export' },
    });
    expect(host.asked).toEqual([{ windowId: 'w-7', name: 'Export', label: 'Export' }]);
    expect(outcome.isError).toBeUndefined();
    expect(text(outcome.content)).toContain("Pointing at 'Export' on screen 2");
  });

  it('points at a rectangle of one display', async () => {
    const host = pointer({ shown: true, screen: 1 });
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    const outcome = await toolset([host]).run({
      name: POINT_AT,
      input: { displayId: 5, rect, label: 'Chart' },
    });
    expect(host.asked).toEqual([{ displayId: 5, rect, label: 'Chart' }]);
    expect(text(outcome.content)).toContain("Pointing at 'Chart' on screen 1");
  });

  it('cuts a long label to 40 characters', async () => {
    const host = pointer();
    await toolset([host]).run({
      name: POINT_AT,
      input: { windowId: 'w-7', name: 'Export', label: 'x'.repeat(60) },
    });
    expect((host.asked[0] as { label: string }).label).toHaveLength(40);
  });

  it('refuses both shapes at once, neither, and a rectangle with no size', async () => {
    const tools = toolset([pointer()]);
    for (const input of [
      { windowId: 'w-1', name: 'A', displayId: 1, rect: { x: 0, y: 0, width: 1, height: 1 } },
      {},
      { windowId: 'w-1' },
      { displayId: 1, rect: { x: 0, y: 0, width: -4, height: 10 } },
    ]) {
      const outcome = await tools.run({ name: POINT_AT, input });
      expect(outcome.isError, JSON.stringify(input)).toBe(true);
    }
  });

  it('says so when no connected host can point', async () => {
    const blind: PerceptionHost = {
      capabilities: ['displays'],
      capture: () => Promise.resolve({}),
    };
    const outcome = await toolset([blind]).run({
      name: POINT_AT,
      input: { windowId: 'w-1', name: 'Export' },
    });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toContain('No connected host can point');
  });

  it('turns a host that fails into an error result rather than a throw', async () => {
    const outcome = await toolset([pointer(new Error('socket closed'))]).run({
      name: POINT_AT,
      input: { windowId: 'w-1', name: 'Export' },
    });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toContain('socket closed');
  });

  it('repeats the host’s reason when nothing was shown', async () => {
    const outcome = await toolset([
      pointer({ shown: false, notes: ["There is no element named 'Export' in that window."] }),
    ]).run({ name: POINT_AT, input: { windowId: 'w-1', name: 'Export' } });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toContain("no element named 'Export'");
  });

  it('says a blocked window was not read', async () => {
    const outcome = await toolset([
      pointer({ shown: false, blocked: { rule: 'processName', entry: '1Password.exe' } }),
    ]).run({ name: POINT_AT, input: { windowId: 'w-1', name: 'Vault' } });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toContain('exclusion list');
  });

  it('never mentions clicking anywhere in what the model sees', async () => {
    const tools = toolset([pointer()]);
    const definition = tools.definitions.find((tool) => tool.name === POINT_AT);
    const outcomes = await Promise.all([
      tools.run({ name: POINT_AT, input: { windowId: 'w-1', name: 'Export' } }),
      tools.run({ name: POINT_AT, input: {} }),
      toolset([]).run({ name: POINT_AT, input: { windowId: 'w-1', name: 'Export' } }),
    ]);
    const surface = JSON.stringify(definition) + outcomes.map((o) => text(o.content)).join(' ');
    expect(surface).not.toMatch(/click/i);
  });
});
