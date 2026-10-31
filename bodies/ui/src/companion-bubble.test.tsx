/** Tests for CompanionBubble and GreetingLine: asking, chips, full chat, talk and voice. */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from './shapes';
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

describe('CompanionBubble wake remarks', () => {
  it('shows a wake’s words as Scout’s message when the bubble is open', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(helloRemark('Time to stretch.')));
    expect(screen.getByText('Time to stretch.')).toBeVisible();
  });

  it('keeps an answer being streamed: a wake’s words never cut in on it', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    ask('hi');
    act(() => bridge.emit(helloRemark('Time to stretch.')));
    expect(screen.queryByText('Time to stretch.')).toBeNull();
  });
});

describe('CompanionBubble', () => {
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

describe('CompanionBubble and background turns', () => {
  it('never takes a background turn for the person’s own, whose answer still streams', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('my question'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'job-turn',
        petId: 'scout',
        conversationId: CONVERSATION,
        background: true,
      });
    });
    act(() => bridge.emit({ type: 'turn.delta', turnId: 'job-turn', text: 'Job gist.' }));
    act(() => bridge.emit(done('job-turn', 'Job gist.')));
    act(() =>
      bridge.emit({
        type: 'turn.started',
        turnId: 'mine',
        petId: 'scout',
        conversationId: CONVERSATION,
      }),
    );
    act(() => bridge.emit(done('mine', 'My answer.')));
    expect(screen.queryByText('Job gist.')).toBeNull();
    expect(screen.getByText('My answer.')).toBeVisible();
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
        <CompanionBubble petId="scout" petName="Scout" tail="left" />
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
});

describe('CompanionBubble voice', () => {
  it.each([
    ['refusal', 'Declined'],
    ['tool_limit', 'Stopped: too many steps'],
  ] as const)('shows a quiet %s status', async (stopReason, status) => {
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
      bridge.emit({ ...done('turn-1', ''), stopReason });
    });
    expect(screen.getByText(status)).toBeInTheDocument();
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
    keyLabel: 'Right Ctrl',
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

  it('asks what it heard as a spoken question, and hints at the reply once the answer is done', async () => {
    const bridge = createFakeHostBridge();
    const host = heard();
    renderBubble(bridge, {
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
    await act(async () => undefined);

    act(() => {
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: '’s green.' });
      bridge.emit(done('turn-1', 'It checks shutdown. It’s green.'));
    });
    await act(async () => undefined);
    expect(screen.getByText('Hold Right Ctrl to reply')).toBeInTheDocument();
  });

  it('barge-in: talking while Scout answers stops that turn', async () => {
    const bridge = createFakeHostBridge();
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

    act(() => listeners.forEach((listen) => listen()));
    expect(bridge.interrupts).toEqual(['turn-1']);

    act(() => {
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: ' also checks restarts.' });
      bridge.emit({ ...done('turn-1', 'It checks shutdown. It also'), stopReason: 'aborted' });
    });
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
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
    renderBubble(bridge, { status: { id: 'mic-busy' } });
    expect(screen.getByTestId('status-row')).toHaveTextContent(
      'Another app is using the microphone.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(openFix).toHaveBeenCalledWith('voice');
  });
});

describe('GreetingLine with a status mark', () => {
  it('shows the mark’s row and its Fix it instead of words', () => {
    const onFix = vi.fn();
    render(
      <GreetingLine
        petName="Scout"
        status={{ id: 'mic-failed' }}
        onFix={onFix}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByTestId('status-row')).toHaveTextContent(
      'The microphone could not be opened.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(onFix).toHaveBeenCalledWith('voice');
  });
});

// The "Approved for you" card is hosted by the panel (ApprovedReport, approved-card.test.tsx).
describe('the approval offer ask', () => {
  it('an approval_offer ask renders its text and exactly two buttons and answering sends the chosen option', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() =>
      bridge.emit({
        type: 'connector.confirm',
        approvalId: '20000000-0000-4000-8000-000000000001',
        turnId: '',
        petId: 'scout',
        app: 'Scout',
        tool: 'approval_offer',
        summary: 'You often say yes to edits here. Want me to approve them?',
        options: ['Yes, auto-approve', 'Keep asking'],
      }),
    );
    const card = screen.getByRole('region', { name: 'Scout asks' });
    expect(card).toHaveTextContent('You often say yes to edits here. Want me to approve them?');
    const buttons = within(card).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Yes, auto-approve', 'Keep asking']);
    await act(async () => {
      fireEvent.click(buttons[0]!);
      await Promise.resolve();
    });
    expect(bridge.jobAnswers).toEqual([
      { approvalId: '20000000-0000-4000-8000-000000000001', option: 'Yes, auto-approve' },
    ]);
  });
});
