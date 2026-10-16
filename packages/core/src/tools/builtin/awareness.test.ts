/** Tests for the recall_screen and what_changed tools: input checks and host refusals. */
import { describe, expect, it } from 'vitest';
import type {
  CaptureExclusions,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
} from '@tagalong/protocol';
import type { BrainContentBlock } from '../../providers';
import type { PerceptionHost } from '../../perception/host';
import { fakeTurnTools } from '../fake-turn';
import type { ToolOutcome } from '../tool';
import { RECALL_SCREEN, WHAT_CHANGED } from './awareness';

const NO_EXCLUSIONS: CaptureExclusions = { processNames: [], titlePatterns: [] };
const IMAGE = { mime: 'image/png' as const, base64: 'iVBORw0KGgo=', width: 640, height: 360 };
const NOW = Date.parse('2026-10-04T10:10:00.000Z');

function blocks(content: ToolOutcome['content']): BrainContentBlock[] {
  if (typeof content === 'string') throw new Error(`expected blocks, got text: ${content}`);
  return content;
}

function text(content: ToolOutcome['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((block) => (block.type === 'text' ? block.text : '[image]')).join('\n');
}

function recallHost(
  recall: PerceptionRecallResult,
  diff?: PerceptionDiffResult,
): PerceptionHost & { recalls: PerceptionRecallParams[]; diffs: PerceptionDiffParams[] } {
  const recalls: PerceptionRecallParams[] = [];
  const diffs: PerceptionDiffParams[] = [];
  return {
    capabilities: ['screenshot', 'activeWindow', 'displays', 'recall'],
    recalls,
    diffs,
    capture: () => Promise.resolve({}),
    recall: (params) => {
      recalls.push(params);
      return Promise.resolve(recall);
    },
    diff: (params) => {
      diffs.push(params);
      return Promise.resolve(diff ?? { changeRatio: 0, afterAt: new Date(NOW).toISOString() });
    },
  };
}

function toolset(hosts: readonly PerceptionHost[], vision = true) {
  return fakeTurnTools(
    { perception: { hosts: () => hosts, exclusions: () => NO_EXCLUSIONS, now: () => NOW } },
    { vision },
  );
}

const FIVE_MINUTES_AGO = '2026-10-04T10:05:00.000Z';

const REMEMBERED: PerceptionRecallResult = {
  recording: true,
  oldestAt: '2026-10-04T10:00:05.000Z',
  capturedAt: FIVE_MINUTES_AGO,
  frames: [{ displayId: 1, capturedAt: FIVE_MINUTES_AGO, image: IMAGE }],
  windows: [
    {
      id: 'w1',
      processName: 'chrome.exe',
      title: 'Attention Is All You Need',
      state: 'foreground',
      browser: true,
    },
  ],
  focusedWindow: { processName: 'chrome.exe', title: 'Attention Is All You Need' },
};

describe('recall_screen', () => {
  it('is offered with the other built-in tools', () => {
    const names = toolset([]).definitions.map((tool) => tool.name);
    expect(names).toContain(RECALL_SCREEN);
    expect(names).toContain(WHAT_CHANGED);
  });

  it('tells the pet to name the time it describes', () => {
    const definition = toolset([]).definitions.find((tool) => tool.name === RECALL_SCREEN);
    expect(definition?.description).toMatch(/time/i);
  });

  it('asks the host for the moment and returns the frame as an image with its time', async () => {
    const host = recallHost(REMEMBERED);
    const outcome = await toolset([host]).run({
      name: RECALL_SCREEN,
      input: { secondsAgo: 300 },
    });

    expect(host.recalls).toEqual([{ secondsAgo: 300 }]);
    const content = blocks(outcome.content);
    expect(content).toContainEqual({ type: 'image', mime: 'image/png', base64: IMAGE.base64 });
    expect(text(content)).toContain(FIVE_MINUTES_AGO);
    expect(text(content)).toContain('5 minutes ago');
    expect(text(content)).toContain('Attention Is All You Need');
  });

  it('passes a display id through', async () => {
    const host = recallHost(REMEMBERED);
    await toolset([host]).run({ name: RECALL_SCREEN, input: { secondsAgo: 60, displayId: 1 } });
    expect(host.recalls).toEqual([{ secondsAgo: 60, displayId: 1 }]);
  });

  it('says rolling memory is off rather than describing nothing', async () => {
    const host = recallHost({ recording: false, frames: [], windows: [] });
    const outcome = await toolset([host]).run({ name: RECALL_SCREEN, input: { secondsAgo: 60 } });
    expect(text(outcome.content)).toMatch(/rolling memory is off/i);
    expect(text(outcome.content)).toMatch(/Settings/);
  });

  it('says how far back memory reaches when asked for something older', async () => {
    const host = recallHost({
      ...REMEMBERED,
      oldestAt: '2026-10-04T10:09:00.000Z',
      capturedAt: '2026-10-04T10:09:00.000Z',
      frames: [{ displayId: 1, capturedAt: '2026-10-04T10:09:00.000Z', image: IMAGE }],
    });
    const outcome = await toolset([host]).run({ name: RECALL_SCREEN, input: { secondsAgo: 600 } });
    expect(text(outcome.content)).toMatch(/only reaches back 1 minute/i);
  });

  it('describes the frame in words for a pet that cannot see', async () => {
    const host = recallHost(REMEMBERED);
    const outcome = await toolset([host], false).run({
      name: RECALL_SCREEN,
      input: { secondsAgo: 300 },
    });
    expect(typeof outcome.content).toBe('string');
    expect(text(outcome.content)).toMatch(/cannot look at images/);
    expect(text(outcome.content)).toContain('Attention Is All You Need');
  });

  it('refuses without a secondsAgo', async () => {
    const outcome = await toolset([recallHost(REMEMBERED)]).run({ name: RECALL_SCREEN, input: {} });
    expect(outcome.isError).toBe(true);
  });

  it('says so when no host can recall', async () => {
    const outcome = await toolset([]).run({ name: RECALL_SCREEN, input: { secondsAgo: 5 } });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toMatch(/No connected host/);
  });
});

describe('what_changed', () => {
  const CHANGED: PerceptionDiffResult = {
    changeRatio: 0.125,
    beforeAt: '2026-10-04T10:08:00.000Z',
    afterAt: '2026-10-04T10:10:00.000Z',
    bounds: { x: 100, y: 200, width: 300, height: 40 },
    before: IMAGE,
    after: { ...IMAGE, base64: 'YWZ0ZXI=' },
  };

  it('asks the host for a diff and returns before and after as images with their times', async () => {
    const host = recallHost(REMEMBERED, CHANGED);
    const outcome = await toolset([host]).run({
      name: WHAT_CHANGED,
      input: { displayId: 1, sinceSeconds: 120 },
    });

    expect(host.diffs).toEqual([{ displayId: 1, sinceSeconds: 120, includeImages: true }]);
    const content = blocks(outcome.content);
    expect(content.filter((block) => block.type === 'image')).toHaveLength(2);
    expect(text(content)).toContain('2026-10-04T10:08:00.000Z');
    expect(text(content)).toContain('13%');
    expect(text(content)).toContain('100,200');
  });

  it('says nothing changed when nothing did', async () => {
    const host = recallHost(REMEMBERED, {
      changeRatio: 0,
      beforeAt: '2026-10-04T10:08:00.000Z',
      afterAt: '2026-10-04T10:10:00.000Z',
    });
    const outcome = await toolset([host]).run({
      name: WHAT_CHANGED,
      input: { displayId: 1, sinceSeconds: 120 },
    });
    expect(text(outcome.content)).toMatch(/Nothing changed/);
  });

  it('says there was nothing to compare with when there is no earlier frame', async () => {
    const host = recallHost(REMEMBERED);
    const outcome = await toolset([host]).run({
      name: WHAT_CHANGED,
      input: { displayId: 1, sinceSeconds: 120 },
    });
    expect(text(outcome.content)).toMatch(/nothing to compare/i);
  });

  it('refuses a missing display or time', async () => {
    const outcome = await toolset([recallHost(REMEMBERED)]).run({
      name: WHAT_CHANGED,
      input: { displayId: 1 },
    });
    expect(outcome.isError).toBe(true);
  });

  it('turns a host failure into a tool result, not a dead turn', async () => {
    const host: PerceptionHost = {
      ...recallHost(REMEMBERED),
      diff: () => Promise.reject(new Error('capture is blocked while KeePass.exe has focus')),
    };
    const outcome = await toolset([host]).run({
      name: WHAT_CHANGED,
      input: { displayId: 1, sinceSeconds: 5 },
    });
    expect(outcome.isError).toBe(true);
    expect(text(outcome.content)).toContain('KeePass.exe');
  });
});
