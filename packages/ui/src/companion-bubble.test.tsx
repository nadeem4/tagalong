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

const BEAT_ONE =
  'Hi, I’m Scout. I sit in the corner of your screen and keep an eye on what you’re working on, never on passwords or private windows.';
const BEAT_TWO =
  'Ask me about whatever you’re on. When it needs real work, I brief an expert, like Claude Code, and bring the answer back.';

/** Says whether the person asked for reduced motion; jsdom has no matchMedia of its own. */
function prefersReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }) as never,
  );
}

/** Steps through the intro's first two beats to the last one. */
function toLastBeat(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('CompanionBubble intro', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('introduces itself in three beats after Welcome, with Next between them', () => {
    prefersReducedMotion(true);
    const onDismiss = vi.fn();
    renderBubble(createFakeHostBridge(), {
      greeting: true,
      hotkeyLabel: 'Ctrl+Shift+Space',
      onDismiss,
    });

    expect(screen.getByRole('status')).toHaveTextContent(BEAT_ONE);
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('status')).toHaveTextContent(BEAT_TWO);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('status')).toHaveTextContent('Press Ctrl+Shift+Space anytime.');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try it now' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('types each beat in, while a screen reader hears the whole line at once', () => {
    prefersReducedMotion(false);
    vi.useFakeTimers();
    renderBubble(createFakeHostBridge(), { greeting: true });

    const shown = screen.getByTestId('intro-typed');
    expect(shown.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(shown.textContent!.length).toBeLessThan(BEAT_ONE.length);
    expect(screen.getByRole('status')).toHaveTextContent(BEAT_ONE);

    act(() => vi.advanceTimersByTime(10_000));
    expect(shown).toHaveTextContent(BEAT_ONE);
  });

  it('greets by name in the first beat when the person gave one', () => {
    prefersReducedMotion(true);
    renderBubble(createFakeHostBridge(), { greeting: true, userName: 'Nadeem' });
    expect(screen.getByRole('status')).toHaveTextContent(
      BEAT_ONE.replace('Hi, I’m Scout.', 'Hi Nadeem, I’m Scout.'),
    );
  });

  it('keeps the first beat unchanged with no name', () => {
    prefersReducedMotion(true);
    renderBubble(createFakeHostBridge(), { greeting: true, userName: '' });
    expect(screen.getByRole('status')).toHaveTextContent(BEAT_ONE);
  });

  it('shows each beat whole, with no typing, when motion is reduced', () => {
    prefersReducedMotion(true);
    renderBubble(createFakeHostBridge(), { greeting: true });
    expect(screen.getByTestId('intro-typed')).toHaveTextContent(BEAT_ONE);
  });
});

describe('CompanionBubble', () => {
  it('tries it at once from the hello: looks at the screen and asks about it', async () => {
    const bridge = createFakeHostBridge({ capture: SNAPSHOT });
    const onDismiss = vi.fn();
    renderBubble(bridge, { greeting: true, onDismiss });
    toLastBeat();

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
    toLastBeat();
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

  it('ignores turns of other pets', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'x',
        petId: 'ink',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('x', 'Ink talking.'));
    });
    expect(screen.queryByText('Ink talking.')).toBeNull();
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

  it('does not speak another pet’s answer', () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    renderBubble(bridge, { onSay });
    act(() => bridge.emit(done('someone-else', 'Not for this bubble.')));
    expect(onSay).not.toHaveBeenCalled();
  });

  it('says each beat of the hello aloud, once, as it appears', () => {
    const onSay = vi.fn();
    renderBubble(createFakeHostBridge(), { greeting: true, onSay });
    expect(onSay).toHaveBeenCalledOnce();
    expect(onSay.mock.calls[0]?.[0]).toMatch(/^Hi, I’m Scout\./);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onSay).toHaveBeenCalledTimes(2);
    expect(onSay.mock.calls[1]?.[0]).toMatch(/^Ask me about whatever/);
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

  it('asks what it heard as a spoken question, and says the answer sentence by sentence', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    const host = heard();
    renderBubble(bridge, { onSay, snapshot: SNAPSHOT, talk: talk({ onHeard: host.onHeard }) });
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
    expect(onSay).toHaveBeenCalledExactlyOnceWith('It checks shutdown.', { whole: true });

    act(() => {
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: '’s green.' });
      bridge.emit(done('turn-1', 'It checks shutdown. It’s green.'));
    });
    expect(onSay).toHaveBeenCalledTimes(2);
    expect(onSay).toHaveBeenLastCalledWith('It’s green.', { whole: true });
    expect(screen.getByText('Hold Ctrl+Shift+Alt+Space to reply')).toBeInTheDocument();
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
