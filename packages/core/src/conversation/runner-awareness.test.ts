/** Tests for recall_screen, what_changed and watch_for inside a real turn. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { PerceptionDiffParams, PerceptionRecallParams, Pet } from '@tagalong/protocol';
import { openDatabase } from '../memory/db';
import { ConversationStore } from '../memory/store';
import { SettingsStore } from '../settings/settings';
import { FakeBrainProvider } from '../providers';
import type { BrainContentBlock, BrainProvider, FakeScript } from '../providers';
import type { PerceptionHost } from '../perception';
import { RECALL_SCREEN, WATCH_FOR, WHAT_CHANGED, type ToolOutcome } from '../tools';
import { FakeClock } from '../watch/fake-clock';
import { WatchManager } from '../watch';
import { ConversationRunner, type TurnEvent } from './runner';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  model: 'fake-model',
  providerId: 'fake',
  roleId: 'companion',
};

const NOW = Date.parse('2026-10-04T10:10:00.000Z');
const THEN = '2026-10-04T10:05:00.000Z';
const FRAME = { mime: 'image/png' as const, base64: 'cmVjYWxs', width: 640, height: 360 };
const AFTER = { mime: 'image/png' as const, base64: 'YWZ0ZXI=', width: 300, height: 40 };

let dir: string;
let db: Database;
let events: TurnEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-runner-awareness-'));
  db = openDatabase(dir);
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A desktop-shaped host with rolling memory: records what the tools asked of it. */
function rememberingHost(): PerceptionHost & {
  recalls: PerceptionRecallParams[];
  diffs: PerceptionDiffParams[];
} {
  const recalls: PerceptionRecallParams[] = [];
  const diffs: PerceptionDiffParams[] = [];
  return {
    capabilities: ['screenshot', 'activeWindow', 'displays', 'recall'],
    recalls,
    diffs,
    capture: () => Promise.resolve({}),
    recall: (params) => {
      recalls.push(params);
      return Promise.resolve({
        recording: true,
        oldestAt: '2026-10-04T10:00:00.000Z',
        capturedAt: THEN,
        frames: [{ displayId: 1, capturedAt: THEN, image: FRAME }],
        windows: [],
        focusedWindow: { processName: 'chrome.exe', title: 'A paper' },
      });
    },
    diff: (params) => {
      diffs.push(params);
      return Promise.resolve({
        changeRatio: 0.05,
        beforeAt: THEN,
        afterAt: '2026-10-04T10:10:00.000Z',
        bounds: { x: 0, y: 700, width: 900, height: 40 },
        before: FRAME,
        after: AFTER,
      });
    },
  };
}

/** The fake brain, with every tool result it was handed kept for the test to read. */
function observing(script: FakeScript): { provider: BrainProvider; results: ToolOutcome[] } {
  const fake = new FakeBrainProvider(script);
  const results: ToolOutcome[] = [];
  return {
    results,
    provider: {
      id: 'observing',
      capabilities: fake.capabilities,
      complete: (req, handlers, signal) =>
        fake.complete(
          req,
          {
            onText: (delta) => handlers.onText(delta),
            onToolUse: async (call) => {
              const result = await handlers.onToolUse(call);
              results.push(result);
              return result;
            },
          },
          signal,
        ),
    },
  };
}

function runner(provider: BrainProvider, host: PerceptionHost): ConversationRunner {
  return new ConversationRunner({
    store: new ConversationStore(db),
    settings: new SettingsStore(dir),
    provider,
    emit: (event) => events.push(event),
    perception: {
      hosts: () => [host],
      exclusions: () => ({ processNames: [], titlePatterns: [] }),
      now: () => NOW,
    },
    // The awareness tools themselves are under test, not which role lists them.
    toolsFor: (_pet, tools) => tools,
  });
}

function textOf(content: ToolOutcome['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is Extract<BrainContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('recall_screen in a turn', () => {
  it('calls perception.recall and returns the frame as an image block with its time', async () => {
    const host = rememberingHost();
    const observed = observing({
      text: 'At 10:05 you were reading a paper.',
      toolCall: { id: 'call-1', name: RECALL_SCREEN, input: { secondsAgo: 300 } },
    });
    const outcome = await runner(observed.provider, host).run({
      pet,
      text: 'what was I reading five minutes ago?',
    }).done;

    expect(host.recalls).toEqual([{ secondsAgo: 300 }]);
    const content = observed.results[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({ type: 'image', mime: 'image/png', base64: FRAME.base64 });
    expect(textOf(content!)).toContain(THEN);
    expect(outcome.stopReason).toBe('end');
    // The panel hears about the tool, and gets a count of images rather than the pixels.
    const result = events.find((event) => event.method === 'turn.toolResult');
    expect(result?.params).toMatchObject({ tool: RECALL_SCREEN, ok: true, summary: '1 image' });
  });
});

describe('what_changed in a turn', () => {
  it('calls perception.diff and returns before and after as image blocks with their times', async () => {
    const host = rememberingHost();
    const observed = observing({
      text: 'Since 10:05 the status bar changed.',
      toolCall: { id: 'call-2', name: WHAT_CHANGED, input: { displayId: 1, sinceSeconds: 300 } },
    });
    await runner(observed.provider, host).run({ pet, text: 'what changed?' }).done;

    expect(host.diffs).toEqual([{ displayId: 1, sinceSeconds: 300, includeImages: true }]);
    const content = observed.results[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const images = (content as BrainContentBlock[]).filter((block) => block.type === 'image');
    expect(images.map((block) => (block as { base64: string }).base64)).toEqual([
      FRAME.base64,
      AFTER.base64,
    ]);
    expect(textOf(content!)).toContain(THEN);
    expect(textOf(content!)).toContain('2026-10-04T10:10:00.000Z');
  });
});

describe('watch_for in a turn', () => {
  it('is offered to a pet and starts a watch for the pet that called it', async () => {
    const host = rememberingHost();
    const manager = new WatchManager({
      clock: new FakeClock(NOW),
      hosts: () => [host],
      provider: () => {
        throw new Error('no check expected');
      },
      limits: () => ({ maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 }),
      emit: () => undefined,
    });
    const observed = observing({
      text: 'Watching it for you.',
      toolCall: {
        id: 'call-3',
        name: WATCH_FOR,
        input: { condition: 'the build finishes', displayId: 1 },
      },
    });
    const run = new ConversationRunner({
      store: new ConversationStore(db),
      settings: new SettingsStore(dir),
      provider: observed.provider,
      emit: (event) => events.push(event),
      watch: { manager, hosts: () => [host] },
      toolsFor: (_pet, tools) => tools,
    });

    await run.run({ pet, text: 'tell me when this finishes' }).done;

    expect(manager.active()).toEqual([
      expect.objectContaining({ petId: 'scout', condition: 'the build finishes' }),
    ]);
    expect(textOf(observed.results[0]!.content)).toMatch(/Watching display 1/);
    manager.stopAll();
  });
});
