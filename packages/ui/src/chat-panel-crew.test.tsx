import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { ChatPanel } from './chat-panel';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const pet = (id: string, name: string, avatar: string, color: string, model: string): Pet => ({
  id,
  name,
  avatar,
  color,
  persona: '',
  model,
  providerId: id === 'ink' ? 'openrouter' : 'nebius',
  toolAllowlist: [],
  replyStyle: 'text',
});

const CREW: Pet[] = [
  pet('scout', 'Scout', '🔎', '#0ea5e9', 'nvidia/nemotron-3-super-120b-a12b'),
  pet('ink', 'Ink', '✒️', '#a855f7', 'anthropic/claude-sonnet-5'),
  pet('bolt', 'Bolt', '⚡', '#f59e0b', 'nvidia/Nemotron-Nano-V2-12b'),
];

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const C1 = '20000000-0000-4000-8000-000000000001';
const C2 = '20000000-0000-4000-8000-000000000002';

function renderCrew(bridge: FakeHostBridge = createFakeHostBridge({ pets: CREW })) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ChatPanel petId="scout" />
    </HostBridgeProvider>,
  );
  return bridge;
}

function send(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
}

function complete(bridge: FakeHostBridge, turnId: string, text: string, extra = {}): void {
  bridge.emit({
    type: 'turn.completed',
    turnId,
    text,
    stopReason: 'end',
    usage: { inputTokens: 1, outputTokens: 1 },
    ...extra,
  });
}

function scoutAnswers(bridge: FakeHostBridge): void {
  act(() => {
    bridge.emit({
      type: 'turn.started',
      turnId: T1,
      petId: 'scout',
      conversationId: C1,
      providerId: 'nebius',
      model: 'nvidia/nemotron-3-super-120b-a12b',
    });
    complete(bridge, T1, 'This page announces a launch.');
  });
}

describe('ChatPanel with a crew', () => {
  it('shows the active pet’s name and colour, and a strip to switch pets', async () => {
    renderCrew();

    const header = await screen.findByTestId('active-pet');
    expect(header).toHaveTextContent('Scout');
    expect(header).toHaveAttribute('data-color', '#0ea5e9');
    expect(screen.getByRole('button', { name: 'Ask Scout' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('asks the pet picked in the strip', async () => {
    const bridge = renderCrew();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Bolt' }));

    send('why does this fail?');

    expect(bridge.asks.at(-1)?.petId).toBe('bolt');
    expect(screen.getByTestId('active-pet')).toHaveTextContent('Bolt');
  });

  it('labels each answer with the pet and the model that said it', async () => {
    const bridge = renderCrew();
    await screen.findByTestId('active-pet');
    send('Explain this page');
    scoutAnswers(bridge);

    const speaker = screen.getByTestId('speaker');
    expect(speaker).toHaveTextContent('Scout');
    expect(speaker).toHaveTextContent('nvidia/nemotron-3-super-120b-a12b');
  });

  it('continues the same conversation on the next ask to the same pet', async () => {
    const bridge = renderCrew();
    await screen.findByTestId('active-pet');
    send('Explain this page');
    scoutAnswers(bridge);

    send('And the second paragraph?');

    expect(bridge.asks.at(-1)).toMatchObject({ petId: 'scout', conversationId: C1 });
  });

  it('shows a handoff as a visible bubble and moves the panel to the pet that took it', async () => {
    const bridge = renderCrew();
    await screen.findByTestId('active-pet');
    send('Explain this page');
    scoutAnswers(bridge);
    send('@Ink draft a reply to this');
    expect(bridge.asks.at(-1)).toMatchObject({ petId: 'scout', conversationId: C1 });

    act(() => {
      bridge.emit({
        type: 'pet.message',
        fromPetId: 'scout',
        toPetId: 'ink',
        kind: 'handoff',
        text: 'The user asked about a launch.\n\nScout said it is on Friday.',
        turnId: T2,
        conversationId: C2,
      });
      bridge.emit({
        type: 'turn.started',
        turnId: T2,
        petId: 'ink',
        conversationId: C2,
        providerId: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
      });
      complete(bridge, T2, 'Thanks — see you Friday!');
    });

    const bubble = screen.getByTestId('handoff');
    expect(bubble).toHaveTextContent('Scout handed this to Ink');
    expect(bubble).toHaveTextContent('Scout said it is on Friday.');
    expect(screen.getByTestId('active-pet')).toHaveTextContent('Ink');
    const speakers = screen.getAllByTestId('speaker').map((node) => node.textContent);
    expect(speakers.at(-1)).toContain('anthropic/claude-sonnet-5');

    send('Make it warmer');
    expect(bridge.asks.at(-1)).toMatchObject({ petId: 'ink', conversationId: C2 });
  });

  it('offers a Hand off menu on an answer that fills the composer with the mention', async () => {
    const bridge = renderCrew();
    await screen.findByTestId('active-pet');
    send('Explain this page');
    scoutAnswers(bridge);

    const menu = screen.getByRole('combobox', { name: 'Hand off' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Hand off…', '✒️ Ink', '⚡ Bolt']);
    fireEvent.change(menu, { target: { value: 'ink' } });

    expect(screen.getByRole('textbox')).toHaveValue('@Ink ');
  });

  it('takes the crew from the host when it passes one, and reports a pet change', async () => {
    const changes: string[] = [];
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <ChatPanel petId="scout" pets={CREW} onPetChange={(id) => changes.push(id)} />
      </HostBridgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask Ink' }));

    await waitFor(() => expect(changes).toEqual(['ink']));
  });
});
