/** Tests for the fake bridge and useHostBridge's missing-provider error. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from './shapes';
import { HostBridgeProvider, useHostBridge } from './host-bridge';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const captured: ContextSnapshot = {
  id: '22222222-2222-4222-8222-222222222222',
  capturedAt: '2026-09-11T10:00:00.000Z',
  host: 'desktop',
  screenshot: { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 1280, height: 800 },
};

describe('createFakeHostBridge', () => {
  it('records what the panel asked the host to perceive and hands back the capture', async () => {
    const bridge = createFakeHostBridge({ capture: captured });

    await expect(bridge.capture(['screenshot', 'activeWindow'])).resolves.toEqual(captured);
    expect(bridge.captures).toEqual([['screenshot', 'activeWindow']]);
  });

  it('resolves to null when the host refuses, standing in for an excluded window', async () => {
    const bridge = createFakeHostBridge();

    await expect(bridge.capture(['screenshot'])).resolves.toBeNull();
  });
});

describe('useHostBridge', () => {
  it('hands components the bridge the host provided', () => {
    const bridge = createFakeHostBridge();

    function Probe() {
      const seen = useHostBridge();
      return <span data-testid="probe">{seen === bridge ? 'same bridge' : 'other bridge'}</span>;
    }

    render(
      <HostBridgeProvider bridge={bridge}>
        <Probe />
      </HostBridgeProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('same bridge');
  });

  it('fails loudly when no host provided a bridge', () => {
    function Probe() {
      useHostBridge();
      return null;
    }

    expect(() => render(<Probe />)).toThrow(/HostBridgeProvider/);
  });
});
