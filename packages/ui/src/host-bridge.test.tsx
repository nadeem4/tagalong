import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, useHostBridge } from './host-bridge';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

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
