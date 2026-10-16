/** Tests for the fake provider scripted by TAGALONG_FAKE_TOOL to call one tool before answering. */
import { describe, expect, it } from 'vitest';
import { createProvider } from './registry';
import type { BrainContentBlock } from './brain';

/**
 * The fake provider can be told to reach for one tool before it answers.
 *
 * It exists for the smoke test. Every tool test in `perception` hands the toolset a fake
 * host, and every host test feeds fixture output, so the socket between them (the
 * `perception.*` methods) is covered by neither. Driving a real tool call through a real
 * host needs a provider that will actually call one, and no test may spend the user's
 * tokens on a real model to get it.
 */
async function runOnce(
  env: Record<string, string | undefined>,
  onToolUse: (call: { id: string; name: string; input: unknown }) => Promise<{
    content: string | BrainContentBlock[];
  }>,
): Promise<void> {
  const provider = createProvider({ providerId: 'fake', env });
  await provider.complete(
    {
      model: 'fake-model',
      maxTokens: 64,
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
    { onText: () => {}, onToolUse },
    new AbortController().signal,
  );
}

describe('the fake provider, scripted to use a tool', () => {
  it('calls no tool by default', async () => {
    const calls: string[] = [];
    await runOnce({ TAGALONG_FAKE_PROVIDERS: '1' }, async (call) => {
      calls.push(call.name);
      return { content: 'ok' };
    });
    expect(calls).toEqual([]);
  });

  it('calls the tool named by TAGALONG_FAKE_TOOL, once, before answering', async () => {
    const calls: string[] = [];
    await runOnce(
      { TAGALONG_FAKE_PROVIDERS: '1', TAGALONG_FAKE_TOOL: 'list_windows' },
      async (call) => {
        calls.push(call.name);
        return { content: 'ok' };
      },
    );
    expect(calls).toEqual(['list_windows']);
  });

  it('passes TAGALONG_FAKE_TOOL_INPUT through as the tool input', async () => {
    // look_closer needs a display id and a rectangle; a tool call with no input would
    // exercise the argument-validation path instead of the host round trip.
    let seen: unknown;
    await runOnce(
      {
        TAGALONG_FAKE_PROVIDERS: '1',
        TAGALONG_FAKE_TOOL: 'look_closer',
        TAGALONG_FAKE_TOOL_INPUT: '{"displayId":1,"rect":{"x":0,"y":0,"width":64,"height":64}}',
      },
      async (call) => {
        seen = call.input;
        return { content: 'ok' };
      },
    );
    expect(seen).toEqual({ displayId: 1, rect: { x: 0, y: 0, width: 64, height: 64 } });
  });

  it('ignores malformed input rather than failing the turn', async () => {
    // The variable is set by hand in a test script. A typo should degrade to no input,
    // not take down the app the smoke test is trying to drive.
    let seen: unknown;
    await runOnce(
      {
        TAGALONG_FAKE_PROVIDERS: '1',
        TAGALONG_FAKE_TOOL: 'list_windows',
        TAGALONG_FAKE_TOOL_INPUT: 'not json',
      },
      async (call) => {
        seen = call.input;
        return { content: 'ok' };
      },
    );
    expect(seen).toBeUndefined();
  });
});
