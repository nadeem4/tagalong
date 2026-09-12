import { useEffect, useState } from 'react';
import type { ContextSnapshot } from '@tagalong/protocol';
import { Composer } from './composer';
import { ContextChip } from './context-chip';
import { MessageList, type ChatMessage } from './message-list';
import { useHostBridge } from './host-bridge';

export interface ChatPanelProps {
  petId: string;
  /** What the host captured for this ask: shown in the chip and sent with the turn. */
  snapshot?: ContextSnapshot;
}

export function ChatPanel({ petId, snapshot }: ChatPanelProps) {
  const bridge = useHostBridge();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  function settle(message: ChatMessage): void {
    setMessages((current) => [...current, message]);
    setStreamingText('');
    setActiveTurnId(null);
  }

  useEffect(
    () =>
      bridge.onTurnEvent((event) => {
        switch (event.type) {
          case 'turn.started':
            setActiveTurnId(event.turnId);
            setStreamingText('');
            break;
          case 'turn.delta':
            setStreamingText((current) => current + event.text);
            break;
          case 'turn.completed':
            // The completed text is authoritative; deltas may have been dropped.
            settle({ id: event.turnId, role: 'assistant', text: event.text });
            break;
          case 'turn.error':
            settle({ id: `${event.turnId}:error`, role: 'assistant', text: event.message });
            break;
          default:
            // Audio and tool events belong to later phases.
            break;
        }
      }),
    [bridge],
  );

  function handleSend(text: string): void {
    setMessages((current) => [...current, { id: `ask:${current.length}`, role: 'user', text }]);
    bridge
      .ask({ petId, text, ...(snapshot !== undefined ? { snapshot } : {}) })
      .catch((error: unknown) => {
        // A bridge that cannot reach the engine must say so, not leave a silent panel.
        settle({
          id: `ask-error:${Date.now()}`,
          role: 'assistant',
          text: error instanceof Error ? error.message : 'The engine could not be reached.',
        });
      });
  }

  return (
    <section className="flex h-full flex-col bg-white text-slate-900">
      <ContextChip snapshot={snapshot ?? null} />
      <MessageList messages={messages} streamingText={streamingText} />
      <Composer onSend={handleSend} disabled={activeTurnId !== null} />
    </section>
  );
}
