/** Tests for MicTest: off until pressed, follows the picked microphone, always stops. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MicTest } from './mic-test';
import type { MicWatcher } from './mic-test';

function setup(deviceId: string | undefined = undefined, stopOnBlur = false) {
  const stops: ReturnType<typeof vi.fn>[] = [];
  let report: { level: (n: number) => void; error: (r: 'denied' | 'busy' | 'no-mic') => void };
  const watch = vi.fn<MicWatcher>((_id, onLevel, onError) => {
    report = { level: onLevel, error: onError };
    const stop = vi.fn();
    stops.push(stop);
    return { stop };
  });
  const view = render(<MicTest watch={watch} deviceId={deviceId} stopOnBlur={stopOnBlur} />);
  return { watch, stops, view, report: () => report };
}

describe('MicTest', () => {
  it('shows no meter until Test your microphone is pressed', () => {
    const { watch } = setup();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(watch).not.toHaveBeenCalled();
    expect(screen.getByText('Nothing is recorded or sent. Speak and the bar moves.')).toBeVisible();
  });

  it('pressing it watches the picked device and shows the level', () => {
    const { watch, report } = setup('mic-1');
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    expect(watch).toHaveBeenCalledWith('mic-1', expect.any(Function), expect.any(Function));
    act(() => report().level(0.5));
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '50');
  });

  it('pressing it again stops', () => {
    const { stops } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop test' }));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('changing the microphone restarts the watch with the new id', () => {
    const { watch, stops, view } = setup('mic-1');
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    view.rerender(<MicTest watch={watch} deviceId="mic-2" />);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenLastCalledWith('mic-2', expect.any(Function), expect.any(Function));
  });

  it('unmounting stops the watch', () => {
    const { stops, view } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    view.unmount();
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it('stops when the window loses focus, only if asked to', () => {
    const { stops } = setup(undefined, true);
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    fireEvent.blur(window);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('keeps running on blur by default', () => {
    const { stops } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    fireEvent.blur(window);
    expect(stops[0]).not.toHaveBeenCalled();
  });

  it('permission denied shows a failure line and no meter', () => {
    const { report } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    act(() => report().error('denied'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Scout is not allowed to use the microphone',
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('button', { name: 'Test your microphone' })).toBeInTheDocument();
  });

  it('says another app holds a busy microphone', () => {
    const { report } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Test your microphone' }));
    act(() => report().error('busy'));
    expect(screen.getByRole('alert')).toHaveTextContent('Another app is using the microphone');
  });
});
