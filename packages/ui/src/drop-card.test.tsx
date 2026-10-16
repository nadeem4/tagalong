/** Tests for the drop card: Explain, hand to an expert, Cancel and the secrets refusal. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { DropCard, type DropOffer } from './drop-card';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const REPORT: DropOffer = {
  dropped: { kind: 'file', name: 'report.md', path: 'C:\\w\\report.md' },
  explain: true,
};

function renderBubble(bridge: FakeHostBridge, drop: DropOffer, onDropDone = vi.fn()) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" drop={drop} onDropDone={onDropDone} />
    </HostBridgeProvider>,
  );
  return onDropDone;
}

const flush = () => act(async () => await Promise.resolve());

describe('the drop card', () => {
  it('asks what to do with the dropped file, by name', () => {
    renderBubble(createFakeHostBridge(), REPORT);
    const card = screen.getByRole('region', { name: 'Dropped on Scout' });
    expect(card).toHaveTextContent('report.md: want me to explain it, or hand it to an expert?');
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand it to an expert' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Explain asks Scout with the drop, in the person’s own words when given', async () => {
    const bridge = createFakeHostBridge();
    const done = renderBubble(bridge, REPORT);
    fireEvent.change(screen.getByLabelText('Add your own words (optional)'), {
      target: { value: 'What is the risk here?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await flush();
    expect(bridge.asks).toEqual([{ petId: 'scout', text: 'What is the risk here?', drop: true }]);
    expect(done).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Dropped on Scout' })).toBeNull();
  });

  it('Explain with no words asks “Explain this.”', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, REPORT);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await flush();
    expect(bridge.asks[0]).toMatchObject({ text: 'Explain this.', drop: true });
  });

  it('Hand it to an expert asks Scout to brief one, naming the path', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, REPORT);
    fireEvent.click(screen.getByRole('button', { name: 'Hand it to an expert' }));
    await flush();
    expect(bridge.asks).toHaveLength(1);
    expect(bridge.asks[0]?.drop).toBe(true);
    expect(bridge.asks[0]?.text).toMatch(/^Hand this to an expert: /);
    expect(bridge.asks[0]?.text).toContain('C:\\w\\report.md');
  });

  it('Cancel asks nothing', async () => {
    const bridge = createFakeHostBridge();
    const done = renderBubble(bridge, REPORT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(bridge.asks).toEqual([]);
    expect(done).toHaveBeenCalled();
  });

  it('offers only the hand-off for a link or a PDF', () => {
    renderBubble(createFakeHostBridge(), {
      dropped: { kind: 'link', text: 'https://example.com/post' },
      explain: false,
    });
    expect(screen.getByRole('region', { name: 'Dropped on Scout' })).toHaveTextContent(
      'https://example.com/post: want me to hand it to an expert?',
    );
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hand it to an expert' })).toBeInTheDocument();
  });

  it('calls dropped text “That text”', () => {
    render(
      <DropCard
        offer={{ dropped: { kind: 'text', text: 'abc' }, explain: true }}
        onAsk={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('That text: want me to explain it');
  });

  it('refuses a secrets file with no buttons at all', () => {
    renderBubble(createFakeHostBridge(), {
      refusal: 'That looks like a secrets file, so I won’t read it or pass it on.',
    });
    const card = screen.getByRole('region', { name: 'Dropped on Scout' });
    expect(card).toHaveTextContent('That looks like a secrets file');
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('is not shown without a drop', () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <CompanionBubble petId="scout" petName="Scout" />
      </HostBridgeProvider>,
    );
    expect(screen.queryByRole('region', { name: 'Dropped on Scout' })).toBeNull();
  });
});
