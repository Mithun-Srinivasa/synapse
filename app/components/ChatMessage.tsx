'use client';

import { motion } from 'framer-motion';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  isStreaming?: boolean;
}

export default function ChatMessage({ role, content, userId, isStreaming }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <motion.div
      className={`ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-ai'}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* Label */}
      <div className={`ai-msg-label ${isUser ? 'ai-msg-label-user' : 'ai-msg-label-ai'}`}>
        {isUser ? (
          <span>{userId.slice(0, 5)}</span>
        ) : (
          <>
            <span className="ai-msg-label-dot" />
            <span>Gemini</span>
          </>
        )}
      </div>

      {/* Content */}
      <div style={{ whiteSpace: 'pre-wrap' }}>
        {content}
        {isStreaming && <span className="ai-streaming-cursor" />}
      </div>
    </motion.div>
  );
}
