'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { socket as getSocket } from '@/lib/socket';
import type { AiCanvasOutput, AiMode } from '@/lib/geminiTypes';
import AiEye from '@/components/AiEye';
import ChatMessage from '@/components/ChatMessage';

interface AiPanelProps {
  roomId: string;
  userId: string;
  mousePosition: { x: number; y: number };
  /** Current viewport transform for canvas→screen coordinate conversion */
  viewport: { zoom: number; panX: number; panY: number };
  /** Called when ai_canvas_output is received — parent handles shape creation */
  onCanvasOutput?: (output: AiCanvasOutput) => void;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  isStreaming?: boolean;
}

/** Generate a short unique message ID (client-side, for optimistic updates) */
function clientMsgId(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

/** Timeout (ms) to auto-reset streaming state if no response arrives */
const STREAMING_TIMEOUT_MS = 30_000;

export default function AiPanel({ roomId, userId, mousePosition, viewport, onCanvasOutput }: AiPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AiMode>('chat');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [saccadeTarget, setSaccadeTarget] = useState<{ x: number; y: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Bug 5 fix: Clear streaming timeout on unmount
  useEffect(() => {
    return () => {
      if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current);
    };
  }, []);

  /** Bug 5 fix: Start a safety timeout that auto-resets isStreaming */
  const startStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current);
    streamingTimeoutRef.current = setTimeout(() => {
      setIsStreaming(false);
      streamingIdRef.current = null;
      setMessages(prev => [...prev, {
        id: `timeout-${Date.now()}`,
        role: 'assistant',
        content: '⚠ Response timed out. Please try again.',
        userId: 'system',
      }]);
    }, STREAMING_TIMEOUT_MS);
  }, []);

  /** Bug 5 fix: Cancel streaming timeout (called when response arrives) */
  const clearStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }
  }, []);

  // Socket event listeners
  useEffect(() => {
    const sock = getSocket();

    const onMessageEcho = ({ message, userId: msgUserId, role, messageId }: {
      message: string; userId: string; role: 'user' | 'assistant'; messageId: string;
    }) => {
      // For streaming assistant messages, we handle them via ai_stream instead
      if (role === 'assistant' && streamingIdRef.current === messageId) return;

      // Don't double-add if this message is already present (optimistic or stream end)
      setMessages(prev => {
        if (prev.some(m => m.id === messageId)) return prev;
        // Bug 1 fix: If this is a user echo for the current user, we already have
        // the optimistic message. Skip adding another one.
        if (role === 'user' && msgUserId === userId) {
          // Check if we have an optimistic message with matching content
          const hasOptimistic = prev.some(m =>
            m.role === 'user' && m.userId === msgUserId && m.content === message && m.id.startsWith('c')
          );
          if (hasOptimistic) return prev;
        }
        return [...prev, { id: messageId, role, content: message, userId: msgUserId }];
      });
    };

    const onStream = ({ chunk, messageId }: { chunk: string; messageId: string }) => {
      streamingIdRef.current = messageId;
      setIsStreaming(true);
      clearStreamingTimeout(); // response arrived, cancel timeout
      setMessages(prev => {
        const existing = prev.find(m => m.id === messageId);
        if (existing) {
          return prev.map(m =>
            m.id === messageId
              ? { ...m, content: m.content + chunk, isStreaming: true }
              : m
          );
        }
        return [...prev, {
          id: messageId,
          role: 'assistant' as const,
          content: chunk,
          userId: 'gemini',
          isStreaming: true,
        }];
      });
    };

    const onStreamEnd = ({ messageId, fullText }: { messageId: string; fullText: string }) => {
      streamingIdRef.current = null;
      setIsStreaming(false);
      clearStreamingTimeout();
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? { ...m, content: fullText, isStreaming: false }
            : m
        )
      );
    };

    const onCanvasOutputEvent = (output: AiCanvasOutput) => {
      setIsStreaming(false);
      clearStreamingTimeout();
      onCanvasOutput?.(output);

      // Bug 8 fix: Convert canvas coords to screen coords using viewport
      if (output.nodes.length > 0) {
        const cx = output.nodes.reduce((sum, n) => sum + n.x + n.width / 2, 0) / output.nodes.length;
        const cy = output.nodes.reduce((sum, n) => sum + n.y + n.height / 2, 0) / output.nodes.length;
        // Canvas→screen: screenX = canvasX * zoom + panX
        const screenX = cx * viewport.zoom + viewport.panX;
        const screenY = cy * viewport.zoom + viewport.panY;
        setSaccadeTarget({ x: screenX, y: screenY });
        setTimeout(() => setSaccadeTarget(null), 2000);
      }
    };

    const onError = ({ message }: { message: string }) => {
      setIsStreaming(false);
      streamingIdRef.current = null;
      clearStreamingTimeout();
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠ ${message}`,
        userId: 'system',
      }]);
    };

    const onChatHistory = ({ messages: history }: {
      messages: Array<{ role: 'user' | 'assistant'; content: string; userId: string; timestamp: number }>;
    }) => {
      // Bug 7 fix: Only apply history if local messages are empty (avoid overwriting
      // messages from a reconnection scenario where new messages were added).
      setMessages(prev => {
        if (prev.length > 0) return prev;
        return history.map((m, i) => ({
          id: `hist-${i}-${m.timestamp}`,
          role: m.role,
          content: m.content,
          userId: m.userId,
        }));
      });
    };

    sock.on('ai_message_echo', onMessageEcho);
    sock.on('ai_stream', onStream);
    sock.on('ai_stream_end', onStreamEnd);
    sock.on('ai_canvas_output', onCanvasOutputEvent);
    sock.on('ai_error', onError);
    sock.on('ai_chat_history', onChatHistory);

    return () => {
      sock.off('ai_message_echo', onMessageEcho);
      sock.off('ai_stream', onStream);
      sock.off('ai_stream_end', onStreamEnd);
      sock.off('ai_canvas_output', onCanvasOutputEvent);
      sock.off('ai_error', onError);
      sock.off('ai_chat_history', onChatHistory);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCanvasOutput, userId, viewport, clearStreamingTimeout]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    // Bug 1 fix: Optimistic local message — show immediately
    const optimisticId = clientMsgId();
    setMessages(prev => [...prev, {
      id: optimisticId,
      role: 'user',
      content: trimmed,
      userId,
    }]);

    const sock = getSocket();
    sock.emit('ai_prompt', {
      message: trimmed,
      mode,
      roomId,
      userId,
    });

    setInputValue('');
    // In both modes, we're waiting for a response
    setIsStreaming(true);
    // Bug 5 fix: start safety timeout
    startStreamingTimeout();
  }, [inputValue, isStreaming, mode, roomId, userId, startStreamingTimeout]);

  // Bug 3 fix: Handle Escape key to close panel or blur input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }, [handleSubmit]);

  return (
    <>
      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="ai-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={SPRING}
          >
            {/* Header */}
            <div className="ai-panel-header">
              <div className="ai-panel-model">
                <span className={`ai-panel-status-dot${isStreaming ? ' streaming' : ''}`} />
                gemini-3.5-flash
              </div>
              <span className="ai-panel-room">{roomId.slice(0, 8)}</span>
            </div>

            {/* Messages */}
            <div className="ai-chat-scroll" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="ai-empty-state">
                  <div className="ai-empty-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  </div>
                  <div>
                    <div className="ai-empty-title">
                      {mode === 'chat' ? 'Whiteboard AI Assistant' : 'Canvas Diagram Generator'}
                    </div>
                    <div className="ai-empty-desc">
                      {mode === 'chat'
                        ? 'Ask questions, brainstorm ideas, or collaborate on your canvas.'
                        : 'Describe a flowchart or diagram to generate shapes on the canvas.'}
                    </div>
                  </div>

                  <div className="ai-empty-suggestions">
                    {mode === 'chat' ? (
                      <>
                        <button
                          type="button"
                          className="ai-suggestion-chip"
                          onClick={() => setInputValue('Suggest ideas for this canvas')}
                        >
                          <span>💡</span> Suggest ideas for this canvas
                        </button>
                        <button
                          type="button"
                          className="ai-suggestion-chip"
                          onClick={() => setInputValue('How can we structure our flowchart?')}
                        >
                          <span>📐</span> How can we structure our flowchart?
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ai-suggestion-chip"
                          onClick={() => setInputValue('User sign-up flow with 4 steps')}
                        >
                          <span>✨</span> User sign-up flow with 4 steps
                        </button>
                        <button
                          type="button"
                          className="ai-suggestion-chip"
                          onClick={() => setInputValue('Microservice architecture diagram')}
                        >
                          <span>⚡</span> Microservice architecture diagram
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                messages.map(msg => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    userId={msg.userId}
                    isStreaming={msg.isStreaming}
                  />
                ))
              )}
            </div>

            {/* Mode Toggle */}
            <div className="ai-mode-toggle">
              <button
                className={`ai-mode-btn${mode === 'chat' ? ' active' : ''}`}
                onClick={() => setMode('chat')}
              >
                💬 Chat
              </button>
              <button
                className={`ai-mode-btn${mode === 'generate' ? ' active' : ''}`}
                onClick={() => setMode('generate')}
              >
                ✨ Generate
              </button>
            </div>

            {/* Input */}
            <div className="ai-input-area">
              <input
                ref={inputRef}
                className="ai-input"
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'chat' ? 'Message...' : 'Describe a diagram...'}
                disabled={isStreaming}
              />
              <button
                className="ai-send-btn"
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isStreaming}
                title="Send"
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating AI Button */}
      <button
        className={`ai-fab${isOpen ? ' open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="AI Chat"
        aria-label="Toggle AI chat panel"
      >
        <AiEye
          mouseX={mousePosition.x}
          mouseY={mousePosition.y}
          saccadeTarget={saccadeTarget}
          isThinking={isStreaming}
        />
      </button>
    </>
  );
}
