/** Tests for step 7: the three load-unpacked steps, the copy buttons and the folder. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepSeven } from './step-seven';
import { makeWalkthroughHost } from './test-host';

describe('StepSeven', () => {
  it('shows the three load-unpacked steps and the installed folder', async () => {
    render(<StepSeven host={makeWalkthroughHost()} />);
    expect(screen.getByRole('heading', { name: 'Let Scout read your browser tabs' })).toBeVisible();
    for (const text of [
      'Open your browser’s extensions page',
      'Turn on Developer mode',
      'Choose Load unpacked, then pick this folder',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(await screen.findByText('C:/app/browser/dist')).toBeInTheDocument();
  });

  it('copies each extensions address', () => {
    const host = makeWalkthroughHost();
    render(<StepSeven host={host} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy chrome://extensions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy edge://extensions' }));
    expect(host.copyText).toHaveBeenNthCalledWith(1, 'chrome://extensions');
    expect(host.copyText).toHaveBeenNthCalledWith(2, 'edge://extensions');
  });

  it('Show folder opens the folder, and Copy folder path copies it', async () => {
    const host = makeWalkthroughHost();
    render(<StepSeven host={host} />);
    await screen.findByText('C:/app/browser/dist');
    fireEvent.click(screen.getByRole('button', { name: 'Show folder' }));
    expect(host.showBrowserFolder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy folder path' }));
    expect(host.copyText).toHaveBeenCalledWith('C:/app/browser/dist');
  });
});
