import { useEffect, useState } from 'react';
import type { ContextSnapshot } from '@tagalong/protocol';
import { Composer } from './composer';
import { MessageList, type ChatMessage } from './message-list';
import { SightBar, type SightProblem } from './sight-bar';
import { useHostBridge } from './host-bridge';

/** What Look asks the host to perceive: the picture, plus which window it came from. */
const LOOK_TARGETS = ['screenshot', 'activeWindow'] as const;

export interface ChatPanelProps {
  petId: string;
  /** What the host captured for this ask: named in the sight bar and sent with the turn. */
  snapshot?: ContextSnapshot;
}

export function ChatPanel({ petId, snapshot }: ChatPanelProps) {
  const bridge = useHostBridge();
  // The host's capture is a starting point, not the last word: Look and Clear own it after.
  const [attached, setAttached] = useState<ContextSnapshot | null>(snapshot ?? null);
  const [problem, setProblem] = useState<SightProblem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  // React's documented way to reset state when a prop changes: a fresh host capture
  // replaces whatever the panel was holding, without an effect and an extra paint.
  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setAttached(snapshot ?? null);
    setProblem(null);
  }

  function settle(message: ChatMessage): void {
    setMessages((current) => [...current, message]);
    setStreamingText('');
    setActiveTurnId(null);
  }

  function handleLook(): void {
    bridge
      .capture(LOOK_TARGETS)
      .then((captured) => {
        // Null is a refusal, not an error: an excluded window has to say so out loud.
        setProblem(captured === null ? 'blocked' : null);
        if (captured !== null) {
          setAttached(captured);
        }
      })
      .catch(() => setProblem('failed'));
  }

  function handleClear(): void {
    setAttached(null);
    setProblem(null);
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
      .ask({ petId, text, ...(attached !== null ? { snapshot: attached } : {}) })
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
      <SightBar snapshot={attached} problem={problem} onLook={handleLook} onClear={handleClear} />
      <MessageList messages={messages} streamingText={streamingText} />
      <Composer onSend={handleSend} disabled={activeTurnId !== null} seeing={attached !== null} />
    </section>
  );
}
