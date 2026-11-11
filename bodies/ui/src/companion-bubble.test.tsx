/** Tests for CompanionBubble and GreetingLine: asking, chips, full chat, talk and voice. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot, TurnEvent } from './shapes';
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

const askIn = (label: string, text: string) => {
  const input = screen.getByLabelText(label);
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

  it('a failed answer sits in an error box with an icon and one Try again that asks it again', async () => {
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
    const box = screen.getByRole('alert');
    expect(box.querySelector('svg')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bridge.asks.map((a) => a.text)).toEqual(['why?', 'why?']));
  });

  it('a failed live reply in the full chat is a full-width box, not inside the avatar column', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { expanded: true });
    await act(async () => {
      const input = screen.getByLabelText('Message Scout');
      fireEvent.change(input, { target: { value: 'why?' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.error', turnId: 'turn-1', code: 'x', message: 'It broke.' });
    });
    expect(screen.getByRole('alert').closest('.bubble-scout')).toBeNull();
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

describe('Scout’s remark survives', () => {
  const REMARK = 'Your 3pm with Dana moved to 3:30. Want me to push the review back too?';
  const turn = (bridge: FakeHostBridge, id: string, text: string) =>
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: id,
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done(id, text));
    });

  it('clicking the quiet line calls onOpen with its text', () => {
    const onOpen = vi.fn();
    render(<GreetingLine petName="Scout" text={REMARK} onDone={() => undefined} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Scout something' }));
    expect(onOpen).toHaveBeenCalledWith(REMARK);
  });

  it('the bubble opened with a remark shows it as Scout’s message', () => {
    renderBubble(createFakeHostBridge(), { remark: REMARK });
    expect(screen.getByText(REMARK)).toBeVisible();
  });

  it('a follow-up question keeps the remark in the log', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { remark: REMARK, expanded: true });
    await act(async () => askIn('Message Scout', 'Yes, and tell Marco too'));
    turn(bridge, 'turn-1', 'Done.');
    const log = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(log.textContent).toMatch(/Dana.*Yes, and tell Marco too.*Done\./);
  });

  it('a remark arriving while open is kept after the next question', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { expanded: true });
    act(() => bridge.emit(helloRemark(REMARK)));
    await act(async () => askIn('Message Scout', 'Yes please'));
    turn(bridge, 'turn-1', 'Pushed.');
    const log = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(log.textContent).toMatch(/Dana.*Yes please.*Pushed\./);
  });

  it('the placeholder goes back to Ask once the follow-up is answered', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { remark: REMARK, expanded: true });
    expect(screen.getByPlaceholderText('Reply to Scout…')).toBeVisible();
    await act(async () => askIn('Message Scout', 'Yes'));
    turn(bridge, 'turn-1', 'Done.');
    expect(screen.getByPlaceholderText('Ask Scout…')).toBeVisible();
  });

  it('a second remark keeps the first above it', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, { expanded: true });
    act(() => bridge.emit(helloRemark('First thing.')));
    act(() => bridge.emit(helloRemark('Second thing.')));
    const log = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(log.textContent).toMatch(/First thing\..*Second thing\./);
  });

  it('the expanded chat shows the remark as its first message', () => {
    renderBubble(createFakeHostBridge(), { remark: REMARK, expanded: true });
    const log = screen.getByRole('log', { name: 'Conversation with Scout' });
    expect(within(log).getByText(REMARK)).toBeVisible();
    expect(within(log).queryByText(/anything about what is on your screen/)).toBeNull();
  });

  it('back to bubble then chat again still shows the remark', () => {
    const bridge = createFakeHostBridge();
    const tree = (expanded: boolean) => (
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" remark={REMARK} expanded={expanded} />
      </HostBridgeProvider>
    );
    const { rerender } = render(tree(false));
    rerender(tree(true));
    rerender(tree(false));
    expect(screen.getByText(REMARK)).toBeVisible();
    rerender(tree(true));
    expect(within(screen.getByRole('log')).getByText(REMARK)).toBeVisible();
  });

  it('a remark exchange has no user tile', async () => {
    const bridge = createFakeHostBridge();
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" remark={REMARK} expanded />
      </HostBridgeProvider>,
    );
    await act(async () => askIn('Message Scout', 'Yes'));
    turn(bridge, 'turn-1', 'Ok.');
    expect(container.querySelectorAll('.bubble-mine')).toHaveLength(1);
  });
});

describe('GreetingLine, Scout’s own line', () => {
  const IDLE = { src: 'fake://idle.webp', frames: 36, fps: 12, loop: true };

  it('shows the Scout label and mark', () => {
    const { container } = render(
      <GreetingLine petName="Scout" text="Hello." scout={IDLE} onDone={() => undefined} />,
    );
    expect(container.querySelector('.scout-mark')).not.toBeNull();
    expect(container.querySelector('.bubble-who')).toHaveTextContent('Scout');
  });

  it('shows Click to reply', () => {
    render(<GreetingLine petName="Scout" text="Hello." onDone={() => undefined} />);
    expect(screen.getByText('Click to reply')).toBeVisible();
  });

  it('shows speaking bars only while speaking', () => {
    const { container, rerender } = render(
      <GreetingLine petName="Scout" text="Hello." onDone={() => undefined} />,
    );
    expect(container.querySelector('.bubble-bars')).toBeNull();
    rerender(<GreetingLine petName="Scout" text="Hello." speaking onDone={() => undefined} />);
    expect(container.querySelector('.bubble-bars')).not.toBeNull();
  });

  it('keeps its accessible name Ask Scout something', () => {
    render(<GreetingLine petName="Scout" text="Hello." onDone={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ask Scout something' })).toBeVisible();
  });

  it('a status line has no Scout mark and no hint', () => {
    const { container } = render(
      <GreetingLine
        petName="Scout"
        status={{ id: 'no-key' }}
        scout={IDLE}
        onDone={() => undefined}
      />,
    );
    expect(container.querySelector('.scout-mark')).toBeNull();
    expect(screen.queryByText('Click to reply')).toBeNull();
  });
});

describe('CompanionBubble, the chat window', () => {
  const REMARK = 'Your 3pm with Dana moved to 3:30.';
  const IDLE = { src: 'fake://idle.webp', frames: 36, fps: 12, loop: true };

  it('collapse and close are icon buttons with their names', () => {
    renderBubble(createFakeHostBridge(), {
      expanded: true,
      onCollapse: () => undefined,
      onClose: () => undefined,
    });
    for (const name of ['Back to bubble', 'Close']) {
      const button = screen.getByRole('button', { name });
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
    expect(screen.getByRole('button', { name: 'Back to bubble' })).toHaveAttribute(
      'title',
      'Back to bubble',
    );
  });

  it('the remark in the bubble shows the Scout mark and label', () => {
    const { container } = render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" remark={REMARK} scout={IDLE} />
      </HostBridgeProvider>,
    );
    const who = container.querySelector('.bubble-who');
    expect(who).toHaveTextContent('Scout');
    expect(who?.querySelector('.scout-mark')).not.toBeNull();
  });

  it('puts the Scout label on a remark in the log but not on an answer', async () => {
    const bridge = createFakeHostBridge();
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" remark={REMARK} expanded />
      </HostBridgeProvider>,
    );
    await act(async () => askIn('Message Scout', 'Yes'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 't1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit(done('t1', 'Pushed.'));
    });
    expect(container.querySelectorAll('.bubble-who')).toHaveLength(1);
  });

  describe('scrolling to the newest message', () => {
    afterEach(() => vi.restoreAllMocks());
    function pinned(height: { value: number }) {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height.value);
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    }

    it('scrolls the log to the bottom when the chat opens', () => {
      pinned({ value: 700 });
      renderBubble(createFakeHostBridge(), { expanded: true, remark: REMARK });
      expect(screen.getByRole('log').scrollTop).toBe(700);
    });

    it('scrolls the log to the bottom when new text streams in', async () => {
      const height = { value: 700 };
      pinned(height);
      const bridge = createFakeHostBridge();
      renderBubble(bridge, { expanded: true });
      await act(async () => askIn('Message Scout', 'hi'));
      act(() => {
        bridge.emit({
          type: 'turn.started',
          turnId: 't1',
          petId: 'scout',
          conversationId: CONVERSATION,
        });
      });
      height.value = 1200;
      act(() => bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'More and more text' }));
      expect(screen.getByRole('log').scrollTop).toBe(1200);
    });

    it('scrolls the log to the bottom when an install card arrives', () => {
      const height = { value: 700 };
      pinned(height);
      const bridge = createFakeHostBridge();
      renderBubble(bridge, { expanded: true });
      height.value = 1800;
      act(() =>
        bridge.emit({
          type: 'connector.confirm',
          approvalId: 'a1',
          turnId: 't1',
          tool: 'install_app',
          app: 'notion',
          summary: 'Install Notion?',
          options: ['allow', 'deny'],
          facts: { app: 'notion' },
        } as never),
      );
      expect(screen.getByRole('log').scrollTop).toBe(1800);
    });

    it('scrolls the log to the bottom when a card arrives', () => {
      const height = { value: 700 };
      pinned(height);
      const bridge = createFakeHostBridge();
      const tree = (drop?: { refusal: string }) => (
        <HostBridgeProvider bridge={bridge}>
          <CompanionBubble petId="scout" petName="Scout" expanded {...(drop ? { drop } : {})} />
        </HostBridgeProvider>
      );
      const { rerender } = render(tree());
      height.value = 1500;
      rerender(tree({ refusal: 'That looks like a secrets file.' }));
      expect(screen.getByRole('log').scrollTop).toBe(1500);
    });
  });
});

describe('CompanionBubble, a turn in the chat window', () => {
  const start = (bridge: FakeHostBridge) =>
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
    });

  it('thinking shows three dots, then says what Scout is doing once it reaches for a tool', async () => {
    const bridge = createFakeHostBridge();
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    await act(async () => askIn('Message Scout', 'why?'));
    start(bridge);
    expect(container.querySelectorAll('.bubble-dots i')).toHaveLength(3);
    act(() =>
      bridge.emit({
        type: 'turn.toolRequest',
        turnId: 'turn-1',
        approvalId: 'a',
        callId: 'a',
        tool: 'search_web',
        input: {},
      }),
    );
    expect(screen.getByText('Scout is searching the web…')).toBeVisible();
  });

  it('thinking shows dots and Scout is thinking, with Stop on the same row', async () => {
    const bridge = createFakeHostBridge();
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    await act(async () => askIn('Message Scout', 'why?'));
    start(bridge);
    const row = screen.getByText('Scout is thinking…').closest('.bubble-live');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.bubble-dots')).not.toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(row?.contains(stop)).toBe(true);
    expect(stop.querySelector('i')).not.toBeNull();
    fireEvent.click(stop);
    expect(bridge.interrupts).toEqual(['turn-1']);
    expect(container.querySelector('.bubble-streaming')).toBeNull();
  });

  it('shows a streaming cursor while text arrives and not once done', async () => {
    const bridge = createFakeHostBridge();
    const { container } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    await act(async () => askIn('Message Scout', 'why?'));
    start(bridge);
    act(() => bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: 'Because ' }));
    expect(container.querySelector('.bubble-streaming')).not.toBeNull();
    act(() => bridge.emit(done('turn-1', 'Because.')));
    expect(container.querySelector('.bubble-streaming')).toBeNull();
  });

  it('dims the field while a turn runs, keeps it focusable, and restores it after', async () => {
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    const field = screen.getByLabelText('Message Scout');
    expect(field).not.toHaveAttribute('aria-busy', 'true');
    await act(async () => askIn('Message Scout', 'why?'));
    start(bridge);
    expect(field).toHaveAttribute('aria-busy', 'true');
    expect(field).not.toBeDisabled();
    fireEvent.change(field, { target: { value: 'again' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(bridge.asks).toHaveLength(1);
    act(() => bridge.emit(done('turn-1', 'Because.')));
    expect(field).not.toHaveAttribute('aria-busy', 'true');
  });
});

describe('CompanionBubble, the chat footer and empty state', () => {
  const IDLE = { src: 'fake://idle.webp', frames: 36, fps: 12, loop: true };
  const talk = (keyLabel: string) => ({
    state: 'idle' as const,
    onHeard: () => () => undefined,
    note: null,
    keyLabel,
    onMic: () => undefined,
  });
  const chat = (props: Partial<Parameters<typeof CompanionBubble>[0]> = {}) =>
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" expanded {...props} />
      </HostBridgeProvider>,
    );

  it('puts the status row above the field', () => {
    const { container } = chat({ talk: { ...talk('Right Ctrl'), note: 'Nothing heard' } });
    const foot = container.querySelector('.bubble-foot');
    const field = foot?.querySelector('.bubble-field');
    const status = foot?.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.compareDocumentPosition(field!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for a reply after a remark', () => {
    chat({ remark: 'Your 3pm moved.' });
    expect(screen.getByLabelText('Message Scout')).toHaveAttribute(
      'placeholder',
      'Reply to Scout…',
    );
  });

  it('keeps the default placeholder with no remark', () => {
    chat();
    expect(screen.getByLabelText('Message Scout')).toHaveAttribute('placeholder', 'Ask Scout…');
  });

  it('shows the Bean and the same sentence in the empty chat', () => {
    const { container } = chat({ scout: IDLE });
    expect(screen.getByText('Ask Scout anything about what is on your screen.')).toBeVisible();
    expect(container.querySelector('.bubble-empty .scout-mark')).toHaveStyle({ width: '48px' });
  });

  it('shows the real talk key as a keycap', () => {
    const { container, unmount } = chat({ talk: talk('Right Ctrl') });
    expect(container.querySelector('.bubble-empty kbd')).toHaveTextContent('Right Ctrl');
    expect(container.querySelector('.bubble-empty')).toHaveTextContent('Hold Right Ctrl to talk');
    unmount();
    const second = chat({ talk: talk('F9') });
    expect(second.container.querySelector('.bubble-empty kbd')).toHaveTextContent('F9');
  });

  it('shows no talk hint without a talk prop', () => {
    const { container } = chat();
    expect(container.querySelector('.bubble-empty kbd')).toBeNull();
    expect(container.querySelector('.bubble-empty')).not.toHaveTextContent('to talk');
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
    type Handler = (text: string, interrupted?: { turn: string; heard: number }) => void;
    const handlers = new Set<Handler>();
    return {
      onHeard: (handler: Handler) => {
        handlers.add(handler);
        return () => void handlers.delete(handler);
      },
      hear: (text: string, interrupted?: { turn: string; heard: number }) =>
        handlers.forEach((handler) => handler(text, interrupted)),
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

  it('the mic carries the drawn tooltip with the talk key, not the native title', () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk()} />
      </HostBridgeProvider>,
    );
    const mic = screen.getByRole('button', { name: 'Talk to Scout' });
    expect(mic).not.toHaveAttribute('title');
    const tip = document.getElementById('tip-mic');
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(tip).toHaveClass('bubble-tip--up');
    expect(mic).toHaveAccessibleDescription('Hold Right Ctrl to talk');
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
    const toggle = screen.getByRole('button', { name: 'Always listening' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('');
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
    expect(screen.getByRole('button', { name: 'Always listening' })).toHaveAttribute(
      'aria-pressed',
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

  it('has a Seeing icon toggle beside it', () => {
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
    const seeing = screen.getByRole('button', { name: 'Seeing your screen' });
    expect(seeing).toHaveAttribute('aria-pressed', 'true');
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

  it('sends what was heard of Scout with a question spoken over it', async () => {
    const bridge = createFakeHostBridge();
    const host = heard();
    renderBubble(bridge, { snapshot: SNAPSHOT, talk: talk({ onHeard: host.onHeard }) });
    await act(async () => host.hear('wait', { turn: 't1', heard: 2 }));
    expect(bridge.asks).toEqual([
      {
        petId: 'scout',
        text: 'wait',
        snapshot: SNAPSHOT,
        spoken: true,
        interrupted: { turn: 't1', heard: 2 },
      },
    ]);
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

describe('a permission ask in the middle of a streaming turn', () => {
  const said = 'Saving that your favourite colour is teal.';
  const askId = '20000000-0000-4000-8000-000000000002';
  const confirmEvent = (summary: string): TurnEvent => ({
    type: 'connector.confirm',
    approvalId: askId,
    turnId: 'turn-1',
    petId: 'scout',
    app: 'Scout',
    tool: 'remember',
    summary,
    options: ['allow', 'always', 'deny'],
  });

  /** A turn that said `lead`, read something, then said `said` and asked. */
  async function twoStep(lead: string) {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('remember teal'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: lead });
      bridge.emit({
        type: 'turn.toolRequest',
        turnId: 'turn-1',
        approvalId: 'toolu_01',
        tool: 'read_screen',
        input: {},
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: said });
      bridge.emit({
        type: 'turn.toolRequest',
        turnId: 'turn-1',
        approvalId: 'toolu_02',
        tool: 'remember',
        input: {},
      });
      bridge.emit(confirmEvent(said));
    });
    return bridge;
  }

  it('shows the step words once, in the card, and keeps the earlier lead and Stop', async () => {
    await twoStep('Let me check. ');
    expect(screen.getAllByText(said)).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Allow remember?' })).toHaveTextContent(said);
    expect(screen.getByText('Let me check.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('still shows the step once when the card summary is cut short', async () => {
    const long = `${said} ${'More words. '.repeat(30)}`;
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await act(async () => ask('remember teal'));
    act(() => {
      bridge.emit({
        type: 'turn.started',
        turnId: 'turn-1',
        petId: 'scout',
        conversationId: CONVERSATION,
      });
      bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: long });
      bridge.emit({
        type: 'turn.toolRequest',
        turnId: 'turn-1',
        approvalId: 'toolu_02',
        tool: 'remember',
        input: {},
      });
      bridge.emit(confirmEvent(long.slice(0, 200)));
    });
    expect(screen.getAllByText(/Saving that your favourite/)).toHaveLength(1);
  });

  it('shows the full text again once the card is answered', async () => {
    const bridge = await twoStep('Let me check. ');
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: askId } as never));
    expect(screen.getByText(/Let me check\./)).toHaveTextContent(said);
  });

  const call = (id: string, tool = 'remember'): TurnEvent => ({
    type: 'turn.toolRequest',
    turnId: 'turn-1',
    approvalId: id,
    tool,
    input: {},
  });

  it('cuts at the same step when parallel calls share it', async () => {
    const bridge = await twoStep('Let me check. ');
    act(() => bridge.emit(call('toolu_03', 'remember_more')));
    expect(screen.getAllByText(said)).toHaveLength(1);
    expect(screen.getByText('Let me check.')).toBeInTheDocument();
  });

  it('shows the whole text when the turn ends while the card is open', async () => {
    const bridge = await twoStep('Let me check. ');
    act(() =>
      bridge.emit({
        type: 'turn.completed',
        turnId: 'turn-1',
        text: `Let me check. ${said} Done.`,
        stopReason: 'end',
      }),
    );
    expect(screen.queryByRole('region', { name: 'Allow remember?' })).not.toBeInTheDocument();
    expect(screen.getByText(/Done\./)).toHaveTextContent(said);
  });

  it('cuts text streamed after the ask while the card is open, and shows it after', async () => {
    const bridge = await twoStep('Let me check. ');
    act(() => bridge.emit({ type: 'turn.delta', turnId: 'turn-1', text: ' Waiting on you.' }));
    expect(screen.queryByText(/Waiting on you/)).not.toBeInTheDocument();
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: askId } as never));
    expect(screen.getByText(/Waiting on you/)).toBeInTheDocument();
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

describe('CompanionBubble on navy', () => {
  it('marks every bubble surface on-navy and rings focus in gold', () => {
    const bridge = createFakeHostBridge();
    const { container, rerender } = render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('.bubble')).toHaveClass('on-navy');
    const css = [...container.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('--tg-focus');
    expect(css).not.toContain('outline: 2px solid #7CB8F2');
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('.bubble--chat')).toHaveClass('on-navy');
    rerender(
      <HostBridgeProvider bridge={bridge}>
        <GreetingLine petName="Scout" text="Hello" onDone={() => undefined} />
      </HostBridgeProvider>,
    );
    expect(container.querySelector('.bubble--line')).toHaveClass('on-navy');
  });

  it('keeps the context chips in their own row, away from the close button', () => {
    renderBubble(createFakeHostBridge(), { snapshot: SNAPSHOT, onClose: () => undefined });
    const chips = screen.getByRole('list', { name: 'What Scout can see' });
    const close = screen.getByRole('button', { name: 'Close' });
    const header = close.closest('.bubble-head');
    expect(header).not.toBeNull();
    expect(header!.contains(chips)).toBe(false);
    expect(chips.closest('.bubble-head')).toBeNull();
  });
});

describe('the live job line', () => {
  const running = (text: string) => ({
    job: 'j1',
    expert: 'Claude Code',
    text,
    at: '2026-11-02T10:00:00Z',
  });

  it('shows the running step, quiet, and drops it when the job ends', async () => {
    const bridge = createFakeHostBridge({ runningSteps: [running('npm init -y')] });
    renderBubble(bridge);
    const line = await screen.findByTestId('job-line');
    expect(line).toHaveTextContent('Claude Code is working');
    expect(line.querySelector('code')).toHaveTextContent('npm init -y');
    expect(line.getAttribute('aria-live')).toBe('off');
    const openFix = vi.spyOn(bridge, 'openFix');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Tasks' }));
    expect(openFix).toHaveBeenCalledWith('tasks');
    bridge.running = [];
    act(() => bridge.emitChanged('jobs'));
    await waitFor(() => expect(screen.queryByTestId('job-line')).toBeNull());
  });

  it('is absent with no running job', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    await waitFor(() => expect(bridge.runningStepCalls).toBe(1));
    expect(screen.queryByTestId('job-line')).toBeNull();
  });

  it('shows a long step whole, wrapped rather than cut', async () => {
    const long = `cat ${'C:/very/long/path/'.repeat(8)}file.ts`;
    renderBubble(createFakeHostBridge({ runningSteps: [running(long)] }));
    const line = await screen.findByTestId('job-line');
    expect(line.querySelector('code')?.textContent).toBe(long);
  });
});
