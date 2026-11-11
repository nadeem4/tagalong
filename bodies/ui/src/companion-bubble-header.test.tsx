/**
 * Tests for the chat refresh (E3): the header's icon toggles and expand, the composer, the
 * job line and chips that no longer clip. Quick bubble and full chat share the same header parts.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { CHAT_CSS } from './chat-styles';
import { HostBridgeProvider } from './host-bridge';
import { ruleOf } from './test-support/css-rules';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const talk = (change: object = {}) => ({
  state: 'idle' as const,
  onHeard: () => () => undefined,
  note: null,
  keyLabel: 'Right Ctrl',
  onMic: vi.fn(),
  ...change,
});

function show(props: Partial<Parameters<typeof CompanionBubble>[0]> = {}) {
  return render(
    <HostBridgeProvider bridge={createFakeHostBridge()}>
      <CompanionBubble petId="scout" petName="Scout" {...props} />
    </HostBridgeProvider>,
  );
}

describe('header icon toggles', () => {
  it('listening toggle is an icon button with aria-pressed and a tooltip', () => {
    const onToggle = vi.fn();
    show({ talk: talk({ always: { on: false, paused: false, onToggle } }) });
    const toggle = screen.getByRole('button', { name: 'Always listening' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(toggle).toHaveTextContent('');
    expect(toggle.parentElement).toHaveTextContent('Always listening: off');
    expect(toggle.parentElement).toHaveTextContent(
      'Click to turn on. Hold Right Ctrl to talk once.',
    );
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('seeing toggle likewise', () => {
    const onToggle = vi.fn();
    show({ talk: talk(), seeing: { on: true, onToggle } });
    const toggle = screen.getByRole('button', { name: 'Seeing your screen' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle.parentElement).toHaveTextContent('Seeing your screen: on');
  });

  it('the status line says what Scout is doing', () => {
    const always = { on: true, paused: false, onToggle: vi.fn() };
    const { unmount } = show({
      expanded: true,
      talk: talk({ always }),
      seeing: { on: true, onToggle: vi.fn() },
    });
    expect(screen.getByTestId('head-status')).toHaveTextContent('Listening · seeing your screen');
    unmount();
    show({
      expanded: true,
      talk: talk({ always: { ...always, on: false } }),
      seeing: { on: false, onToggle: vi.fn() },
    });
    expect(screen.getByTestId('head-status')).toHaveTextContent('Not listening or looking');
  });
});

describe('quick bubble header', () => {
  it("has Scout's name, the status line and the toggles, expand and close, in a 52px header", () => {
    show({
      talk: talk({ always: { on: true, paused: false, onToggle: vi.fn() } }),
      seeing: { on: true, onToggle: vi.fn() },
      onOpenChat: vi.fn(),
      onClose: vi.fn(),
    });
    const head = screen.getByTestId('head-status').closest('header');
    expect(head).not.toBeNull();
    expect(head).toHaveClass('bubble-head--quick');
    expect(head).toHaveTextContent('Listening · seeing your screen');
    for (const name of ['Always listening', 'Seeing your screen', 'Open full chat', 'Close']) {
      expect(head?.querySelector(`[aria-label="${name}"]`)).not.toBeNull();
    }
    expect(ruleOf(CHAT_CSS, '.bubble-head--quick')).toContain('height: 52px');
  });
});

describe('header status while a conversation is open', () => {
  it('both off with a message sent says Ready, not the empty-chat wording', () => {
    show({
      expanded: true,
      talk: talk({ always: { on: false, paused: false, onToggle: vi.fn() } }),
      seeing: { on: false, onToggle: vi.fn() },
    });
    fireEvent.change(screen.getByLabelText('Message Scout'), { target: { value: 'hi' } });
    fireEvent.keyDown(screen.getByLabelText('Message Scout'), { key: 'Enter' });
    expect(screen.getByTestId('head-status')).toHaveTextContent('Ready');
  });
});

describe('header expand and hints', () => {
  it('expand icon opens the full chat', () => {
    const onOpenChat = vi.fn();
    show({ onOpenChat });
    const expand = screen.getByRole('button', { name: 'Open full chat' });
    expect(expand.querySelector('svg')).not.toBeNull();
    expect(expand).toHaveTextContent('');
    fireEvent.click(expand);
    expect(onOpenChat).toHaveBeenCalledOnce();
  });

  it('no hint strip', () => {
    show({ onOpenChat: vi.fn(), onClose: vi.fn() });
    expect(screen.queryByText('Enter to ask')).toBeNull();
    expect(screen.queryByText('Esc to close')).toBeNull();
  });

  it('placeholder names the talk key', () => {
    show({ talk: talk() });
    expect(screen.getByLabelText('Ask Scout')).toHaveAttribute(
      'placeholder',
      'Ask Scout… or hold Right Ctrl to talk',
    );
  });
});

describe('composer', () => {
  it('Shift+Enter adds a line, Enter sends', () => {
    show({ expanded: true });
    const box = screen.getByLabelText('Message Scout');
    expect(box.tagName).toBe('TEXTAREA');
    // Not cancelled: the browser inserts the newline itself.
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
    fireEvent.change(box, { target: { value: 'hello' } });
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    expect(screen.getByRole('log')).toHaveTextContent('hello');
  });

  it('has a Send button, disabled while empty', () => {
    show({ expanded: true });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message Scout'), { target: { value: 'hi' } });
    expect(send).toBeEnabled();
  });
});

describe('nothing clips', () => {
  it('job line shows the whole step', async () => {
    const step = 'npm run build -- --mode production --verbose';
    const bridge = createFakeHostBridge({
      runningSteps: [{ job: 'j1', expert: 'Claude Code', text: step, at: '2026-11-10T10:00:00Z' }],
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" expanded />
      </HostBridgeProvider>,
    );
    const line = await waitFor(() => screen.getByTestId('job-line'));
    expect(line).toHaveTextContent('Claude Code');
    expect(line).toHaveTextContent(step);
    expect(line).not.toHaveAttribute('title');
    expect(ruleOf(CHAT_CSS, '.bubble-jobline')).not.toMatch(/nowrap|ellipsis/);
  });

  it('chips do not truncate', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-chip span')).not.toMatch(/nowrap|ellipsis/);
  });

  it('header keeps Close inside at 420px with large text', () => {
    expect(ruleOf(CHAT_CSS, '.bubble-headwho')).toMatch(/min-width:\s*0/);
    expect(ruleOf(CHAT_CSS, '.bubble-head .bubble-row')).toMatch(/flex:\s*none/);
  });
});
