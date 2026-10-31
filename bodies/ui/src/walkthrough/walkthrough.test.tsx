/** Tests for the walkthrough shell: side list, footer, Back and Next, Skip for now and Skip tour. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HAS_KEY, makeWalkthroughHost } from './test-host';
import { Walkthrough } from './walkthrough';

const SCOUT = { src: 'bean.webp', frames: 1, fps: 1, loop: false };

function open(host = makeWalkthroughHost(), initialStep?: number) {
  render(
    <Walkthrough
      host={host}
      scout={SCOUT}
      {...(initialStep === undefined ? {} : { initialStep })}
    />,
  );
  return host;
}

const sideButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('Walkthrough', () => {
  it('renders nine step names and the footnote', () => {
    open();
    const list = screen.getByRole('list', { name: 'Steps' });
    expect(list.querySelectorAll('li')).toHaveLength(9);
    expect(
      screen.getByText('You can change all of this later in Home, under Settings.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your companion')).toBeInTheDocument();
  });

  it('disables Back on step 1', () => {
    open();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('Next advances, and Skip for now advances without saving', async () => {
    const host = open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One companion for all your AI tools',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'How it fits together' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Things you can ask' });
    expect(host.saveSettings).not.toHaveBeenCalled();
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('the side list jumps only to reached steps', async () => {
    open();
    expect(sideButton('Voice')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'How it fits together' });
    fireEvent.click(sideButton('Welcome'));
    await screen.findByRole('heading', { name: 'One companion for all your AI tools' });
    expect(sideButton('How it fits')).toBeEnabled();
    expect(sideButton('What to ask')).toBeDisabled();
  });

  it('opens at the step it is given and counts every step before it as reached', () => {
    open(makeWalkthroughHost(), 9);
    expect(sideButton('Welcome')).toBeEnabled();
    expect(sideButton('API key')).toHaveAttribute('aria-current', 'step');
  });

  it('Skip tour with a key closes and calls finishWalkthrough', async () => {
    const host = open(makeWalkthroughHost({ key: HAS_KEY }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(host.finishWalkthrough).toHaveBeenCalledTimes(1));
  });

  it('Skip tour without a key goes to step 9 and does not finish', async () => {
    const host = open();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(sideButton('API key')).toHaveAttribute('aria-current', 'step'));
    expect(host.finishWalkthrough).not.toHaveBeenCalled();
  });

  it('Skip tour with the brain offline counts as no key', async () => {
    const host = open(makeWalkthroughHost({ key: 'offline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(sideButton('API key')).toHaveAttribute('aria-current', 'step'));
    expect(host.finishWalkthrough).not.toHaveBeenCalled();
  });

  it('saves nothing before Next, so Back loses no data', async () => {
    const host = open(makeWalkthroughHost(), 4);
    await screen.findByText('Ctrl+Shift+Space');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Ask key'), { target: { value: 'Alt+Space' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Things you can ask' });
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it('does not advance when the save fails, and says why', async () => {
    const host = makeWalkthroughHost();
    host.saveSettings.mockRejectedValueOnce(new Error('That shortcut is taken.'));
    open(host, 4);
    await screen.findByText('Ctrl+Shift+Space');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Ask key'), { target: { value: 'Alt+Space' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That shortcut is taken.');
    expect(sideButton('Asking')).toHaveAttribute('aria-current', 'step');
  });

  it('moves focus to the new step headline when the step changes', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const heading = await screen.findByRole('heading', { name: 'How it fits together' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
