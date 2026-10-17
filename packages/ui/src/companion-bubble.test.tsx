/** Tests for CompanionBubble and GreetingLine: asking, chips, full chat, talk and voice. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { CompanionBubble, GreetingLine } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const SNAPSHOT: ContextSnapshot = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  capturedAt: '2026-10-12T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code', windowTitle: 'engine.test.ts - ai_pet - Visual Studio Code' },
  selection: 'shuts down while a turn is running',
};

const TRY_IT = 'What am I working on, and what could you hand to an expert?';

const CONVERSATION = '10000000-0000-4000-8000-0000000000c1';

function renderBubble(
  bridge: FakeHostBridge,
  props: Partial<Parameters<typeof CompanionBubble>[0]> = {},
) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" {...props} />
    </HostBridgeProvider>,
  );
}

function spokenMouth() {
  const spokenLines: string[] = [];
  const mouth = {
    speak: (text: AsyncIterable<string>) =>
      void (async () => {
        for await (const line of text) spokenLines.push(line);
      })(),
    stop: vi.fn(),
  };
  return { mouth, spokenLines };
}

const done = (turnId: string, text: string) =>
  ({
    type: 'turn.completed',
    turnId,
    text,
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
  }) as const;

const ask = (text: string) => {
  const input = screen.getByLabelText('Ask Scout');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

const HELLO = 'Hi Sam. Ask me about anything on your screen.';
const helloRemark = (text = HELLO, extra: Record<string, unknown> = {}) =>
  ({
    type: 'pet.remark',
    remarkId: '00000000-0000-4000-8000-0000000000aa',
    petId: 'scout',
    text,
    ...extra,
  }) as const;

/** Says whether the person asked for reduced motion; jsdom has no matchMedia of its own. */
function prefersReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }) as never,
  );
}

describe('CompanionBubble invitation after setup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('writes no line of its own: Try it now and Got it, until the mind says one', () => {
    prefersReducedMotion(true);
    const onDismiss = vi.fn();
    const onSay = vi.fn();
    renderBubble(createFakeHostBridge(), { greeting: true, onDismiss, onSay });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByText(/Here I am/)).toBeNull();
    expect(onSay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try it now' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows the first hello’s check-in line above Try it now, and says it once', () => {
    prefersReducedMotion(true);
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    renderBubble(bridge, { greeting: true, onSay });
    act(() => bridge.emit(helloRemark()));
    expect(screen.getByRole('status')).toHaveTextContent(HELLO);
    expect(screen.getByRole('button', { name: 'Try it now' })).toBeVisible();
    expect(onSay).toHaveBeenCalledOnce();
    expect(onSay).toHaveBeenCalledWith(HELLO);
    // A line about a finished hand-off is not the hello.
    act(() => bridge.emit(helloRemark('All green.', { handoffId: crypto.randomUUID() })));
    expect(screen.getByRole('status')).toHaveTextContent(HELLO);
    expect(onSay).toHaveBeenCalledOnce();
  });

  it('types the line in, while a screen reader hears it whole', () => {
    prefersReducedMotion(false);
    vi.useFakeTimers();
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { greeting: true });
    act(() => bridge.emit(helloRemark()));
    const shown = screen.getByTestId('intro-typed');
    expect(shown.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(shown.textContent!.length).toBeLessThan(HELLO.length);
    act(() => vi.advanceTimersByTime(10_000));
    expect(shown).toHaveTextContent(HELLO);
  });

  it('takes no line once the hello is over', async () => {
    const bridge = createFakeHostBridge({ capture: null });
    const onSay = vi.fn();
    renderBubble(bridge, { greeting: true, onSay });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try it now' })));
    act(() => bridge.emit(helloRemark()));
    expect(screen.queryByText(HELLO)).toBeNull();
    expect(onSay).not.toHaveBeenCalled();
  });
});

describe('CompanionBubble', () => {
  it('tries it at once from the hello: looks at the screen and asks about it', async () => {
    const bridge = createFakeHostBridge({ capture: SNAPSHOT });
    const onDismiss = vi.fn();
    renderBubble(bridge, { greeting: true, onDismiss });

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try it now' })));

    expect(bridge.captures).toEqual([['activeWindow', 'screenshot']]);
    expect(bridge.asks).toEqual([{ petId: 'scout', text: TRY_IT, snapshot: SNAPSHOT }]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try it now' })).toBeNull();
    expect(screen.getByText('Scout is thinking…')).toBeVisible();
  });

  it('still tries it when it cannot see the screen, without a snapshot', async () => {
    const bridge = createFakeHostBridge({ capture: null });
    renderBubble(bridge, { greeting: true });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try it now' })));
    expect(bridge.asks).toEqual([{ petId: 'scout', text: TRY_IT }]);
  });

  it('shows what it can see as chips, and asks with that context on Enter', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    expect(screen.getByText('Code · engine.test.ts - ai_pet - Visual Studio Code')).toBeVisible();
    expect(screen.getByText('Selected text')).toBeVisible();

    await act(async () => ask('why does this test fail?'));

    expect(bridge.asks).toEqual([
      { petId: 'scout', text: 'why does this test fail?', snapshot: SNAPSHOT },
    ]);
  });

  it('leaves out what the person removed', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    fireEvent.click(screen.getByRole('button', { name: 'Do not send Selected text' }));
    await act(async () => ask('what is this?'));
    const { selection: _gone, ...rest } = SNAPSHOT;
    expect(bridge.asks[0]?.snapshot).toEqual(rest);
  });

  it('streams the answer into the bubble, with Stop while it runs', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'Because the ' });
    });
    expect(screen.getByText(/Because the/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(bridge.interrupts).toEqual(['turn-1']);

    act(() => bridge.emit(done('turn-1', 'Because the database closed first.')));
    expect(screen.getByText('Because the database closed first.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('formats the answer: bullets and bold, not raw Markdown', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    await act(async () => ask('what now?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', '**Two things:**\n\n- fix the test\n- run it again'));
    });
    expect(screen.getByText('Two things:').tagName).toBe('STRONG');
    expect(screen.getByText('fix the test').tagName).toBe('LI');
    expect(screen.getByText('run it again').tagName).toBe('LI');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('continues the same conversation on the next question', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('first'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'One.'));
    });
    await act(async () => ask('second'));
    expect(bridge.asks[1]).toEqual({
      petId: 'scout',
      conversationId: CONVERSATION,
      text: 'second',
    });
  });

  it('says plainly when the answer fails', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({
        type: 'turn.error',
        turnId: 'turn-1',
        code: 'auth',
        message: 'Claude Code could not answer: Please run /login',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Please run /login');
  });

  it('opens the full chat on request', () => {
    const onOpenChat = vi.fn();
    renderBubble(createFakeHostBridge(), { onOpenChat });
    fireEvent.click(screen.getByRole('button', { name: 'Open full chat' }));
    expect(onOpenChat).toHaveBeenCalledOnce();
  });
});

describe('CompanionBubble, expanded into the full chat', () => {
  async function twoExchanges(bridge: FakeHostBridge) {
    await act(async () => ask('first question'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'First answer.'));
    });
    await act(async () => ask('second question'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-2',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-2', 'Second answer.'));
    });
  }

  it('shows only the latest exchange as a bubble', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await twoExchanges(bridge);
    expect(screen.queryByText('First answer.')).toBeNull();
    expect(screen.getByText('Second answer.')).toBeVisible();
  });

  it('shows the whole conversation when expanded, with a way back to the bubble', async () => {
    const bridge = createFakeHostBridge();
    const onCollapse = vi.fn();
    const { rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onOpenChat={() => undefined} />
      </HostBridgeProvider>,
    );
    await twoExchanges(bridge);
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded onCollapse={onCollapse} />
      </HostBridgeProvider>,
    );
    const thread = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(thread.textContent).toMatch(
      /first question.*First answer\..*second question.*Second answer\./,
    );
    expect(screen.getByLabelText('Message Scout')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to bubble' }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});

describe('CompanionBubble, attached to the pet', () => {
  it('closes from its × button, in the bubble and in the full chat', () => {
    const onClose = vi.fn();
    const bridge = createFakeHostBridge();
    const { rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onClose={onClose} />
      </HostBridgeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded onClose={onClose} />
      </HostBridgeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('points its tail at the pet, on whichever side the pet is', () => {
    const bridge = createFakeHostBridge();
    const { container, rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" tail="right" />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('[data-tail]')).toHaveAttribute('data-tail', 'right');
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" tail="left" greeting />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('[data-tail]')).toHaveAttribute('data-tail', 'left');
  });
});

describe('CompanionBubble, a draft', () => {
  const DRAFT_REPLY =
    "Here's a draft. Copy it and paste it in.\n\n```draft\nYes, Friday works.\n```";

  it("copies Scout's draft through the host on Copy", async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { snapshot: SNAPSHOT });
    await act(async () => ask('reply yes but Friday'));
    act(() => bridge.emit(done('turn-1', DRAFT_REPLY)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy' })));
    expect(bridge.copied).toEqual(['Yes, Friday works.']);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('shows the draft with no Copy when the host cannot copy', async () => {
    const bridge = createFakeHostBridge();
    delete (bridge as { copyText?: unknown }).copyText;
    renderBubble(bridge, { snapshot: SNAPSHOT });
    await act(async () => ask('reply yes but Friday'));
    act(() => bridge.emit(done('turn-1', DRAFT_REPLY)));
    expect(screen.getByText('Yes, Friday works.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });
});

describe('GreetingLine', () => {
  afterEach(() => vi.useRealTimers());

  it('says one line politely, then leaves on its own after a few seconds', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(
      <GreetingLine petName="Scout" text="Morning. I’m here when you need me." onDone={onDone} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Morning. I’m here when you need me.');
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('stays while the pointer is on it, and leaves after it moves away', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<GreetingLine petName="Scout" text="Evening." onDone={onDone} />);
    const line = screen.getByRole('status').closest('.bubble')!;
    fireEvent.mouseEnter(line);
    act(() => vi.advanceTimersByTime(30_000));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.mouseLeave(line);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('opens the bubble to ask on a click, and closes from its button', () => {
    const onDone = vi.fn();
    const onOpen = vi.fn();
    render(<GreetingLine petName="Scout" text="Evening." onDone={onDone} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Scout something' }));
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('a remark carries Not now, which quiets Scout and closes the line', () => {
    const onDone = vi.fn();
    const onNotNow = vi.fn();
    render(
      <GreetingLine
        petName="Scout"
        text="That build broke on a missing import."
        onDone={onDone}
        onNotNow={onNotNow}
      />,
    );
    expect(screen.queryByRole('button', { name: /hand/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onNotNow).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('a remark with an offer opens the hand-off card only when the person takes it', () => {
    const onDone = vi.fn();
    const onAccept = vi.fn();
    render(
      <GreetingLine
        petName="Scout"
        text="That build broke on a missing import."
        onDone={onDone}
        onNotNow={() => undefined}
        offer={{ label: 'Hand it over', onAccept }}
      />,
    );
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hand it over' }));
    expect(onAccept).toHaveBeenCalledOnce();
  });
});

describe('CompanionBubble voice', () => {
  it('hands each finished answer to be spoken, once', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    renderBubble(bridge, { onSay });
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'Because' });
    });
    expect(onSay).not.toHaveBeenCalled();

    act(() => bridge.emit(done('turn-1', 'Because the database closed first.')));
    expect(onSay).toHaveBeenCalledExactlyOnceWith('Because the database closed first.');
  });

  it.each([
    ['refusal', 'Declined'],
    ['tool_limit', 'Stopped: too many steps'],
  ] as const)('shows a quiet %s status and speaks nothing', async (stopReason, status) => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    renderBubble(bridge, { onSay });
    await act(async () => ask('why?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ ...done('turn-1', ''), stopReason });
    });
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(onSay).not.toHaveBeenCalled();
  });

  it('does not speak the answer to a turn it did not start', () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    renderBubble(bridge, { onSay });
    act(() => bridge.emit(done('someone-else', 'Not for this bubble.')));
    expect(onSay).not.toHaveBeenCalled();
  });

  it('shows that it is speaking, and stops when asked', () => {
    const onStopSpeaking = vi.fn();
    renderBubble(createFakeHostBridge(), { speaking: true, onStopSpeaking });
    fireEvent.click(screen.getByRole('button', { name: 'Stop speaking' }));
    expect(onStopSpeaking).toHaveBeenCalledOnce();
  });

  it('shows no speaking indicator while quiet', () => {
    renderBubble(createFakeHostBridge(), { speaking: false, onStopSpeaking: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Stop speaking' })).toBeNull();
  });
});

describe('CompanionBubble, talking to Scout', () => {
  /** The host's side: a test says what was heard through `hear`. */
  const heard = () => {
    const handlers = new Set<(text: string) => void>();
    return {
      onHeard: (handler: (text: string) => void) => {
        handlers.add(handler);
        return () => void handlers.delete(handler);
      },
      hear: (text: string) => handlers.forEach((handler) => handler(text)),
    };
  };
  const talk = (change: object = {}) => ({
    state: 'idle' as const,
    onHeard: () => () => undefined,
    note: null,
    keyLabel: 'Ctrl+Shift+Alt+Space',
    onMic: vi.fn(),
    ...change,
  });

  it('has the mic inside the text box, not in the header', () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk()} />
      </HostBridgeProvider>,
    );
    const mic = screen.getByRole('button', { name: 'Talk to Scout' });
    expect(mic.closest('.bubble-field')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Talk to Scout' })).toHaveLength(1);
  });

  it('keeps the text box named for what it asks, the mic inside it notwithstanding', () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk()} />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Ask Scout' })).toBeVisible();
  });

  it('switches Always listening from the header, off by default, and says when it is paused', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk({ always: { on: false, paused: false, onToggle } })}
        />
      </HostBridgeProvider>,
    );
    const toggle = screen.getByRole('switch', { name: 'Always listening' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk({ always: { on: true, paused: true, onToggle } })}
        />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('switch', { name: 'Always listening' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Listening paused during a call or full screen.',
    );
    rerender(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk({ always: { on: true, paused: false, onToggle } })}
        />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Listening. Start with “Scout” to ask.');
  });

  it('has a Seeing switch beside it', () => {
    const onToggle = vi.fn();
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk()}
          seeing={{ on: true, onToggle }}
        />
      </HostBridgeProvider>,
    );
    const seeing = screen.getByRole('switch', { name: 'Seeing' });
    expect(seeing).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(seeing);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('has a mic button, which says when it is listening', () => {
    const onMic = vi.fn();
    const { rerender } = render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk({ onMic })} />
      </HostBridgeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Scout' }));
    expect(onMic).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Listening/)).toBeNull();

    rerender(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk({ state: 'listening' })} />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Listening');

    rerender(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk({ state: 'idle', note: 'I didn’t catch that.' })}
        />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('I didn’t catch that.');
  });

  it('shows the words heard so far while listening', () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          talk={talk({ state: 'listening', partial: 'what is' })}
        />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('what is');
    // Live words change about three times a second: a screen reader is not told each one.
    expect(screen.getByText('what is')).toHaveAttribute('aria-live', 'off');
  });

  it('asks what it heard as a spoken question, and says the answer sentence by sentence', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    const { mouth, spokenLines } = spokenMouth();
    const host = heard();
    renderBubble(bridge, {
      onSay,
      mouth,
      snapshot: SNAPSHOT,
      talk: talk({ onHeard: host.onHeard }),
    });
    await act(async () => host.hear('what is this test?'));
    expect(bridge.asks).toEqual([
      { petId: 'scout', text: 'what is this test?', snapshot: SNAPSHOT, spoken: true },
    ]);
    expect(screen.getByText('what is this test?')).toBeInTheDocument();

    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'It checks shutdown. It' });
    });
    // The first sentence is on its way to the voice before the answer is done.
    await act(async () => undefined);
    expect(spokenLines).toEqual(['It checks shutdown.']);

    act(() => {
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: '’s green.' });
      bridge.emit(done('turn-1', 'It checks shutdown. It’s green.'));
    });
    await act(async () => undefined);
    expect(spokenLines).toEqual(['It checks shutdown.', 'It’s green.']);
    expect(onSay).not.toHaveBeenCalled();
    expect(screen.getByText('Hold Ctrl+Shift+Alt+Space to reply')).toBeInTheDocument();
  });

  it('barge-in: talking while Scout answers stops that turn and says no more of it', async () => {
    const bridge = createFakeHostBridge();
    const { mouth, spokenLines } = spokenMouth();
    const host = heard();
    const listeners = new Set<() => void>();
    const onListen = (handler: () => void) => {
      listeners.add(handler);
      return () => void listeners.delete(handler);
    };
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          mouth={mouth}
          talk={talk({ onHeard: host.onHeard, onListen })}
        />
      </HostBridgeProvider>,
    );
    await act(async () => host.hear('what is this test?'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'It checks shutdown. It' });
    });
    await act(async () => undefined);
    expect(spokenLines).toEqual(['It checks shutdown.']);

    act(() => listeners.forEach((listen) => listen()));
    expect(bridge.interrupts).toEqual(['turn-1']);

    act(() => {
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: ' also checks restarts.' });
      bridge.emit({ ...done('turn-1', 'It checks shutdown. It also'), stopReason: 'aborted' });
    });
    await act(async () => undefined);
    expect(spokenLines).toEqual(['It checks shutdown.']);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('speaks a typed "read this to me" whole, and any other typed question through onSay', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    const { mouth, spokenLines } = spokenMouth();
    renderBubble(bridge, { onSay, mouth, snapshot: SNAPSHOT });
    await act(async () => ask('read this to me'));
    expect(bridge.asks[0]).toEqual({
      petId: 'scout',
      text: 'read this to me',
      snapshot: SNAPSHOT,
      spoken: true,
    });

    const reading = 'Shuts down while a turn is running. Then it waits. Then it closes.';
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: reading });
      bridge.emit(done('turn-1', reading));
    });
    await act(async () => undefined);
    // Every sentence is said, not the first two and "the rest is in the bubble".
    expect(spokenLines.join(' ')).toBe(reading);
    expect(onSay).not.toHaveBeenCalled();

    await act(async () => ask('what is this?'));
    expect(bridge.asks[1]).not.toHaveProperty('spoken');
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-2',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-2', 'A test.'));
    });
    expect(onSay).toHaveBeenCalledExactlyOnceWith('A test.');
  });

  it('keeps reading aloud when a typed "go on" answers "Shall I go on?"', async () => {
    const bridge = createFakeHostBridge();
    const { mouth } = spokenMouth();
    renderBubble(bridge, { mouth });
    await act(async () => ask('read it aloud'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'The first part. Shall I go on?'));
    });
    await act(async () => ask('go on'));
    expect(bridge.asks[1]).toMatchObject({ text: 'go on', spoken: true });
  });

  it('keeps a typed question after "Shall I go on?" unspoken unless it says to go on', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    const { mouth } = spokenMouth();
    renderBubble(bridge, { onSay, mouth });
    await act(async () => ask('read it aloud'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'The first part. Shall I go on?'));
    });
    await act(async () => ask('what is my bank password field called?'));
    expect(bridge.asks[1]).not.toHaveProperty('spoken');
  });

  it('does not show a typed read-aloud as something it heard', async () => {
    const bridge = createFakeHostBridge();
    const { mouth } = spokenMouth();
    renderBubble(bridge, { mouth });
    await act(async () => ask('read this to me'));
    expect(screen.queryByText('You said:')).toBeNull();
  });

  it('leaves a typed question unspoken, with no reply hint', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { talk: talk() });
    await act(async () => ask('why?'));
    expect(bridge.asks[0]).not.toHaveProperty('spoken');
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('turn-1', 'Because.'));
    });
    expect(screen.queryByText(/to reply/)).toBeNull();
  });
});

describe('CompanionBubble status marks', () => {
  it('shows the top status mark as a row, with Fix it opening the fix', () => {
    const openFix = vi.fn(() => Promise.resolve());
    const bridge = Object.assign(createFakeHostBridge(), { openFix });
    renderBubble(bridge, { status: { id: 'brain-signed-out' } });
    expect(screen.getByTestId('status-row')).toHaveTextContent(
      'Can’t think: signed out of Claude.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(openFix).toHaveBeenCalledWith('brain');
  });
});

describe('GreetingLine with a status mark', () => {
  it('shows the mark’s row and its Fix it instead of words', () => {
    const onFix = vi.fn();
    render(
      <GreetingLine
        petName="Scout"
        status={{ id: 'brain-no-key' }}
        onFix={onFix}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByTestId('status-row')).toHaveTextContent('Can’t think: no API key.');
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(onFix).toHaveBeenCalledWith('brain');
  });
});
