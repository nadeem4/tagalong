import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface ComposerProps {
  onSend: (text: string) => void;
  /** True while a turn streams: one turn per pet at a time, so a second ask must wait. */
  disabled: boolean;
}

export function Composer({ onSend, disabled }: ComposerProps) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  function send(): void {
    if (disabled || trimmed === '') {
      return;
    }
    setText('');
    onSend(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter stays a newline, which is what people expect of a chat box.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-slate-200 p-2">
      <textarea
        aria-label="Message"
        rows={2}
        value={text}
        disabled={disabled}
        placeholder="Ask about what is on screen"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500 disabled:bg-slate-100"
      />
      <button
        type="button"
        onClick={send}
        disabled={disabled || trimmed === ''}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-300"
      >
        Send
      </button>
    </div>
  );
}
