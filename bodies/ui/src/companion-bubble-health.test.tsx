/** Tests for the bubble's health check: "what's wrong?" answered by the health card. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import type { HealthFacts } from './health';
import { HostBridgeProvider } from './host-bridge';
import type { HostBridge } from './host-bridge';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const FACTS: HealthFacts = {
  key: { hasKey: true },
  connections: [{ name: 'GitHub', status: 'needs-sign-in' }],
  voice: {
    enabled: true,
    earsUsed: false,
    earsReady: false,
  },
  microphone: { count: 1, pickedMissing: false },
};

function setup(health: Partial<HostBridge> = {}) {
  const fake = createFakeHostBridge();
  const checkHealth = vi.fn(() => Promise.resolve(FACTS));
  const openFix = vi.fn(() => Promise.resolve());
  const bridge: HostBridge = Object.assign(fake, { checkHealth, openFix }, health);
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" />
    </HostBridgeProvider>,
  );
  return { fake, checkHealth, openFix };
}

const ask = (text: string) => {
  const input = screen.getByLabelText('Ask Scout');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

const flush = () => act(async () => await Promise.resolve());

describe('CompanionBubble, the health check', () => {
  it('answers “what’s wrong?” with the health card, and asks Scout nothing', async () => {
    const { fake, checkHealth } = setup({});
    ask('Scout, what’s wrong?');
    await flush();
    expect(checkHealth).toHaveBeenCalledOnce();
    expect(fake.asks).toEqual([]);
    const card = screen.getByRole('region', { name: 'Health check' });
    expect(card).toHaveTextContent('One thing needs you.');
    expect(card).toHaveTextContent('GitHub needs you to sign in again.');
  });

  it('asks nothing of the brain even when the question was asked by voice: health is shown', async () => {
    let hear: (text: string) => void = () => undefined;
    const talk = {
      state: 'idle' as const,
      onHeard: (handler: (text: string) => void) => {
        hear = handler;
        return () => undefined;
      },
      note: null,
      keyLabel: 'Right Ctrl',
      onMic: vi.fn(),
    };
    const fake = createFakeHostBridge();
    const bridge: HostBridge = Object.assign(fake, {
      checkHealth: vi.fn(() => Promise.resolve(FACTS)),
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" talk={talk} />
      </HostBridgeProvider>,
    );
    act(() => hear('Scout, what’s wrong?'));
    await flush();
    expect(screen.getByRole('region', { name: 'Health check' })).toHaveTextContent(
      'One thing needs you.',
    );
  });

  it('opens the fix the row names', async () => {
    const { openFix } = setup();
    ask('are you ok?');
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Fix Connections' }));
    expect(openFix).toHaveBeenCalledWith('connections');
  });

  it('opens the logs folder through the host', async () => {
    const openLogs = vi.fn(() => Promise.resolve());
    setup({ openLogs });
    ask('are you ok?');
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }));
    expect(openLogs).toHaveBeenCalledOnce();
  });

  it('leaves a real question to Scout', async () => {
    const { fake, checkHealth } = setup();
    ask('what’s wrong with this code?');
    await flush();
    expect(checkHealth).not.toHaveBeenCalled();
    expect(fake.asks).toHaveLength(1);
  });

  it('says so plainly when the check itself fails', async () => {
    setup({ checkHealth: () => Promise.reject(new Error('gone')) });
    ask('health check');
    await flush();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Health check failed.');
  });

  it('drops a check that finishes after a newer question', async () => {
    let finish: (facts: HealthFacts) => void = () => undefined;
    setup({ checkHealth: () => new Promise<HealthFacts>((resolve) => (finish = resolve)) });
    ask('what’s wrong?');
    await flush();
    ask('explain this error');
    await flush();
    await act(async () => {
      finish(FACTS);
      await Promise.resolve();
    });
    expect(screen.queryByRole('region', { name: 'Health check' })).toBeNull();
  });

  it('clears the card when the next question is asked', async () => {
    setup();
    ask('what’s wrong?');
    await flush();
    expect(screen.getByRole('region', { name: 'Health check' })).toBeInTheDocument();
    ask('explain this error');
    await flush();
    expect(screen.queryByRole('region', { name: 'Health check' })).toBeNull();
  });
});
