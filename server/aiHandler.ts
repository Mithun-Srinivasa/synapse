// aiHandler.ts -- AI chat state manager & socket event handler
// Phase 5: AI integration layer

import type { Server, Socket } from 'socket.io';
import type { ChatHistoryEntry } from './gemini';
import { isGeminiAvailable, streamChatResponse, generateDiagram } from './gemini';
import { compressDocument, decompressDocument } from './redis';
import { Redis } from '@upstash/redis';

// ----------------------------------------------------------------
// Redis client (reuses same env vars as redis.ts)
// ----------------------------------------------------------------
let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface AiPromptPayload {
  message: string;
  mode: 'chat' | 'generate';
  roomId: string;
  userId: string;
}

/** Compact persistence format — minimises Redis storage */
interface CompactMessage {
  r: 'u' | 'a';  // role: user or assistant
  c: string;     // content
  t: number;     // timestamp
  u: string;     // userId
}

interface AiCanvasNode {
  id: string;
  type: 'box' | 'circle' | 'sticky';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AiCanvasEdge {
  from: string;
  to: string;
  label?: string;
}

interface AiCanvasOutput {
  nodes: AiCanvasNode[];
  edges: AiCanvasEdge[];
}

/** In-memory chat message (richer than CompactMessage, used at runtime) */
interface RuntimeMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  userId: string;
}

// ----------------------------------------------------------------
// In-memory conversation history per room (capped at 10 messages)
// ----------------------------------------------------------------
const MAX_HISTORY = 10;
const roomHistories = new Map<string, RuntimeMessage[]>();

/** Generate a short unique message ID */
function generateMessageId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ----------------------------------------------------------------
// Redis persistence helpers
// ----------------------------------------------------------------

const CHAT_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

async function saveChatHistory(roomId: string, history: RuntimeMessage[]): Promise<void> {
  if (!redis) return;
  try {
    // Convert to compact format
    const compact: CompactMessage[] = history.map((m) => ({
      r: m.role === 'user' ? 'u' as const : 'a' as const,
      c: m.content,
      t: m.timestamp,
      u: m.userId,
    }));
    const json = JSON.stringify(compact);
    const compressed = compressDocument(json);
    await redis.set(`chat:${roomId}`, compressed, { ex: CHAT_TTL });
    console.log(
      `💾 [AI] Saved chat history for "${roomId}": ${history.length} messages, ${json.length} chars → ${compressed.length} bytes`
    );
  } catch (err) {
    console.error(`❌ [AI] Error saving chat history for "${roomId}":`, err);
  }
}

async function loadChatHistoryFromRedis(roomId: string): Promise<RuntimeMessage[] | null> {
  if (!redis) return null;
  try {
    const data = await redis.get<string>(`chat:${roomId}`);
    if (!data) return null;
    const json = decompressDocument(data);
    const compact: CompactMessage[] = JSON.parse(json);
    return compact.map((m) => ({
      role: m.r === 'u' ? 'user' as const : 'assistant' as const,
      content: m.c,
      timestamp: m.t,
      userId: m.u,
    }));
  } catch (err) {
    console.error(`❌ [AI] Error loading chat history for "${roomId}":`, err);
    return null;
  }
}

async function clearChatHistoryFromRedis(roomId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`chat:${roomId}`);
    console.log(`🗑️ [AI] Cleared persisted chat history for "${roomId}"`);
  } catch (err) {
    console.error(`❌ [AI] Error clearing chat history for "${roomId}":`, err);
  }
}

// ----------------------------------------------------------------
// History helpers
// ----------------------------------------------------------------

function getOrCreateHistory(roomId: string): RuntimeMessage[] {
  if (!roomHistories.has(roomId)) {
    roomHistories.set(roomId, []);
  }
  return roomHistories.get(roomId)!;
}

function pushMessage(roomId: string, msg: RuntimeMessage): void {
  const history = getOrCreateHistory(roomId);
  history.push(msg);
  // Cap at MAX_HISTORY, keeping most recent
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

/** Convert runtime messages to Gemini SDK ChatHistoryEntry format */
function toGeminiHistory(messages: RuntimeMessage[]): ChatHistoryEntry[] {
  return messages.map((m) => ({
    role: m.role === 'user' ? 'user' as const : 'model' as const,
    parts: [{ text: m.content }],
  }));
}

// ----------------------------------------------------------------
// AiCanvasOutput validation
// ----------------------------------------------------------------

function validateCanvasOutput(data: unknown): AiCanvasOutput | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;

  // Validate each node has required fields
  for (const node of obj.nodes) {
    if (typeof node !== 'object' || node === null) return null;
    const n = node as Record<string, unknown>;
    if (
      typeof n.id !== 'string' ||
      typeof n.type !== 'string' ||
      typeof n.label !== 'string' ||
      typeof n.x !== 'number' ||
      typeof n.y !== 'number' ||
      typeof n.width !== 'number' ||
      typeof n.height !== 'number'
    ) {
      return null;
    }
    if (!['box', 'circle', 'sticky'].includes(n.type)) return null;
  }

  // Validate each edge has required fields
  for (const edge of obj.edges) {
    if (typeof edge !== 'object' || edge === null) return null;
    const e = edge as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string') return null;
    if (e.label !== undefined && typeof e.label !== 'string') return null;
  }

  return obj as unknown as AiCanvasOutput;
}

// ----------------------------------------------------------------
// Chat flow (streaming)
// ----------------------------------------------------------------

async function handleChatFlow(
  io: Server,
  socket: Socket,
  payload: AiPromptPayload
): Promise<void> {
  const { roomId, userId, message } = payload;
  const messageId = generateMessageId();

  // 1. Record user message in history
  const userMsg: RuntimeMessage = {
    role: 'user',
    content: message,
    timestamp: Date.now(),
    userId,
  };
  pushMessage(roomId, userMsg);

  // 2. Broadcast user message echo to all room members
  io.to(roomId).emit('ai_message_echo', {
    message,
    userId,
    role: 'user' as const,
    messageId,
  });

  // 3. Stream Gemini response
  const assistantMessageId = generateMessageId();
  let fullText = '';

  try {
    const geminiHistory = toGeminiHistory(getOrCreateHistory(roomId).slice(0, -1)); // exclude current msg
    const stream = streamChatResponse(geminiHistory, message);

    for await (const chunk of stream) {
      fullText += chunk;
      io.to(roomId).emit('ai_stream', { chunk, messageId: assistantMessageId });
    }

    // 4. Record assistant message in history
    const assistantMsg: RuntimeMessage = {
      role: 'assistant',
      content: fullText,
      timestamp: Date.now(),
      userId: 'gemini',
    };
    pushMessage(roomId, assistantMsg);

    // 5. Signal stream end
    io.to(roomId).emit('ai_stream_end', {
      messageId: assistantMessageId,
      fullText,
    });

    // 6. Broadcast assistant echo for clients that joined mid-stream
    io.to(roomId).emit('ai_message_echo', {
      message: fullText,
      userId: 'gemini',
      role: 'assistant' as const,
      messageId: assistantMessageId,
    });

    // 7. Persist updated history (fire-and-forget)
    saveChatHistory(roomId, getOrCreateHistory(roomId)).catch(() => {});
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during AI response';
    console.error(`❌ [AI] Chat stream error in "${roomId}":`, err);
    socket.emit('ai_error', { message: errorMessage });
  }
}

// ----------------------------------------------------------------
// Generate flow (non-streaming, returns canvas objects)
// ----------------------------------------------------------------

async function handleGenerateFlow(
  io: Server,
  socket: Socket,
  payload: AiPromptPayload
): Promise<void> {
  const { roomId, userId, message } = payload;
  const messageId = generateMessageId();

  // 1. Broadcast user message echo
  io.to(roomId).emit('ai_message_echo', {
    message,
    userId,
    role: 'user' as const,
    messageId,
  });

  try {
    // 2. Get full response from Gemini
    const rawText = await generateDiagram(message);

    // 3. Parse JSON — handle potential markdown code fences
    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error(`❌ [AI] Invalid JSON from Gemini for generate in "${roomId}":`, jsonText);
      socket.emit('ai_error', { message: 'AI returned invalid JSON. Please try rephrasing your request.' });
      return;
    }

    // 4. Validate structure
    const canvasOutput = validateCanvasOutput(parsed);
    if (!canvasOutput) {
      console.error(`❌ [AI] Invalid canvas output structure in "${roomId}":`, parsed);
      socket.emit('ai_error', { message: 'AI returned an invalid diagram structure. Please try again.' });
      return;
    }

    // 5. Emit validated canvas output to all room members
    io.to(roomId).emit('ai_canvas_output', canvasOutput);

    // 6. Echo assistant response in chat
    const assistantMessageId = generateMessageId();
    io.to(roomId).emit('ai_message_echo', {
      message: `Generated a diagram with ${canvasOutput.nodes.length} node(s) and ${canvasOutput.edges.length} edge(s).`,
      userId: 'gemini',
      role: 'assistant' as const,
      messageId: assistantMessageId,
    });

    console.log(
      `🎨 [AI] Generated diagram in "${roomId}": ${canvasOutput.nodes.length} nodes, ${canvasOutput.edges.length} edges`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during diagram generation';
    console.error(`❌ [AI] Generate error in "${roomId}":`, err);
    socket.emit('ai_error', { message: errorMessage });
  }
}

// ----------------------------------------------------------------
// Exported API
// ----------------------------------------------------------------

/**
 * Main handler for `ai_prompt` socket events.
 * Routes to chat or generate flow based on payload mode.
 */
export function handleAiPrompt(
  io: Server,
  socket: Socket,
  payload: AiPromptPayload
): void {
  // Validate payload
  if (!payload.roomId || !payload.message || !payload.userId) {
    socket.emit('ai_error', { message: 'Invalid AI prompt payload: missing required fields.' });
    return;
  }

  if (!isGeminiAvailable()) {
    socket.emit('ai_error', { message: 'AI features are not available. GEMINI_API_KEY is not configured.' });
    return;
  }

  if (payload.mode === 'generate') {
    handleGenerateFlow(io, socket, payload).catch((err) => {
      console.error('❌ [AI] Unhandled generate error:', err);
    });
  } else {
    // Default to chat mode
    handleChatFlow(io, socket, payload).catch((err) => {
      console.error('❌ [AI] Unhandled chat error:', err);
    });
  }
}

/**
 * Load persisted chat history from Redis into memory for a room.
 * Called when the first user joins a room.
 */
export async function loadRoomChatHistory(roomId: string): Promise<void> {
  // Skip if already loaded in memory
  if (roomHistories.has(roomId)) return;

  const persisted = await loadChatHistoryFromRedis(roomId);
  if (persisted && persisted.length > 0) {
    // Cap to MAX_HISTORY
    const capped = persisted.length > MAX_HISTORY
      ? persisted.slice(persisted.length - MAX_HISTORY)
      : persisted;
    roomHistories.set(roomId, capped);
    console.log(`📂 [AI] Loaded ${capped.length} chat message(s) for "${roomId}" from Redis`);
  }
}

/**
 * Flush chat history to Redis then clean up in-memory state.
 * Called when a room is destroyed (last user leaves).
 */
export async function cleanupRoomAi(roomId: string): Promise<void> {
  const history = roomHistories.get(roomId);
  if (history && history.length > 0) {
    await saveChatHistory(roomId, history);
    console.log(`🧹 [AI] Flushed ${history.length} chat message(s) for "${roomId}" to Redis before cleanup`);
  }
  roomHistories.delete(roomId);
}

/**
 * Get current in-memory chat messages for sending to a joining client.
 * Returns an array of user-facing messages (not Gemini SDK format).
 */
export function getRoomChatHistory(roomId: string): Array<{
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  userId: string;
}> {
  return roomHistories.get(roomId) ?? [];
}
