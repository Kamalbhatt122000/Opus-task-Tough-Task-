/**
 * ChatPanel — natural-language stone modifications. Lives in the left
 * sidebar, below the cavity list. Sends the user's message to the backend
 * (which calls Gemini), receives a structured operation list that the
 * parent applies to viewer state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types/api';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onClear?: () => void;
  isThinking: boolean;
  /** Disable input until a session exists (i.e. stage 1 has run). */
  disabled?: boolean;
}

const SUGGESTIONS = [
  'Add a 3mm diamond at the center of the ring',
  'Make all stones bigger',
  'Change to ruby',
  'Remove stone 2',
];

export function ChatPanel({
  messages,
  onSend,
  onClear,
  isThinking,
  disabled,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the conversation pinned to the bottom as new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isThinking || disabled) return;
    onSend(trimmed);
    setInput('');
  }, [input, onSend, isThinking, disabled]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          💬 AI Assistant
        </h3>
        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {messages.length} msg{messages.length === 1 ? '' : 's'}
            </span>
            {onClear && (
              <button
                onClick={onClear}
                disabled={isThinking}
                title="Clear chat memory"
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline-offset-2 hover:underline disabled:opacity-50"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] p-3 max-h-[220px] min-h-[80px] overflow-y-auto space-y-2"
      >
        {messages.length === 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs text-[var(--color-text-muted)] italic">
              Ask the AI to modify stones. Try:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  disabled={disabled || isThinking}
                  className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="text-xs leading-snug">
              <span
                className={`inline-block text-[9px] uppercase tracking-wider mr-1.5 px-1.5 py-0.5 rounded ${
                  m.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]'
                }`}
              >
                {m.role === 'user' ? 'You' : 'AI'}
              </span>
              <span
                className={
                  m.role === 'user'
                    ? 'text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)]'
                }
              >
                {m.text}
              </span>
            </div>
          ))
        )}
        {isThinking && (
          <div className="text-xs text-[var(--color-text-muted)] italic animate-pulse">
            thinking…
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSend();
          }}
          disabled={disabled || isThinking}
          placeholder={
            disabled ? 'Load a mesh to start chatting…' : 'Ask the AI…'
          }
          className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || isThinking || !input.trim()}
          className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-xs font-semibold disabled:bg-[var(--color-bg-hover)] disabled:text-[var(--color-text-muted)] hover:opacity-90 active:scale-[0.97] transition-all"
        >
          Send
        </button>
      </div>
    </div>
  );
}
