/**
 * Chat hook — POSTs the user's message to /api/session/{id}/chat and returns
 * the operations Gemini suggested. Caller applies them to its own state.
 *
 * Prior conversation turns are sent alongside each new message so the model
 * can resolve references like "it" or "the same place".
 */

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, ChatOperation, ChatResponse } from '../types/api';

interface UseChatReturn {
  messages: ChatMessage[];
  isThinking: boolean;
  send: (sessionId: string, message: string) => Promise<ChatOperation[]>;
  clear: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  // Mirror of `messages` for use inside `send` without re-creating the
  // callback on every render (which would re-attach handlers in the parent).
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const send = useCallback(
    async (sessionId: string, message: string): Promise<ChatOperation[]> => {
      const historySnapshot = messagesRef.current;
      setMessages(prev => [...prev, { role: 'user', text: message }]);
      setIsThinking(true);
      try {
        const res = await fetch(`/api/session/${sessionId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history: historySnapshot }),
        });
        if (!res.ok) {
          const text = await res.text();
          setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${text}` }]);
          return [];
        }
        const data: ChatResponse = await res.json();
        setMessages(prev => [...prev, { role: 'assistant', text: data.explanation }]);
        return data.operations ?? [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${msg}` }]);
        return [];
      } finally {
        setIsThinking(false);
      }
    },
    [],
  );

  const clear = useCallback(() => setMessages([]), []);

  return { messages, isThinking, send, clear };
}
