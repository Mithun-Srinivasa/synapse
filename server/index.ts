// index.ts -- Synapse backend: Express HTTP + Socket.io
// Phase 2: real-time canvas sync via socket rooms

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server, type Socket } from 'socket.io';
import { joinRoom, leaveRoom, setSnapshot, hasRoom } from './rooms';
import { getPersistedSnapshot } from './redis';
import { scheduleRedisSave } from './debounce';
import { handleAiPrompt, loadRoomChatHistory, cleanupRoomAi, getRoomChatHistory } from './aiHandler';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';

// Parse comma-separated list of origins
const allowedOrigins = CLIENT_ORIGIN.split(',').map((o) => o.trim());

// Helper function to validate origin
const checkOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    return callback(null, true);
  }
  if (
    allowedOrigins.includes('*') ||
    allowedOrigins.includes(origin) ||
    origin === 'http://localhost:3000' ||
    (origin.startsWith('https://synapse-') && origin.endsWith('.vercel.app'))
  ) {
    return callback(null, true);
  }
  return callback(null, false);
};

// ----------------------------------------------------------------
// Express + HTTP
// ----------------------------------------------------------------
const app = express();
app.use(cors({ origin: checkOrigin }));
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

const httpServer = http.createServer(app);

// ----------------------------------------------------------------
// Socket.io
// ----------------------------------------------------------------
const io = new Server(httpServer, {
  cors: {
    origin: checkOrigin,
    methods: ['GET', 'POST'],
  },
});

// ----------------------------------------------------------------
// Per-socket room tracking (for cleanup on disconnect)
// ----------------------------------------------------------------
// Per-socket room tracking (for cleanup on disconnect)
const socketRooms = new Map<string, string>(); // socketId → roomId
const socketUsers = new Map<string, string>(); // socketId → userId

// ----------------------------------------------------------------
// Event types (must mirror frontend lib/socket.ts)
// ----------------------------------------------------------------

interface CanvasMutation {
  type: 'object:added' | 'object:modified' | 'object:removed' | 'object:layer';
  objectId: string;
  data: Record<string, unknown>;
  userId: string;
}

// ----------------------------------------------------------------
// Connection handler
// ----------------------------------------------------------------
io.on('connection', (socket: Socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ---- join_room -------------------------------------------------
  // Payload: { roomId: string; userId?: string }
  // Response: room:snapshot { snapshot: string | null }
  socket.on('join_room', async ({ roomId, userId }: { roomId: string; userId?: string }) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error', { message: 'Invalid roomId' });
      return;
    }

    // Track which room this socket joined (one room per socket)
    const prevRoom = socketRooms.get(socket.id);
    if (prevRoom && prevRoom !== roomId) {
      leaveRoom(prevRoom, socket);
    }
    socketRooms.set(socket.id, roomId);
    if (userId) {
      socketUsers.set(socket.id, userId);
    }

    // Ensure room is loaded in memory. If not present, check Upstash Redis
    const roomExistsInMemory = hasRoom(roomId);
    if (!roomExistsInMemory) {
      const persistedSnapshot = await getPersistedSnapshot(roomId);
      if (persistedSnapshot) {
        setSnapshot(roomId, persistedSnapshot);
        console.log(`[socket] Loaded persisted board snapshot for room "${roomId}" from Redis.`);
      }
    }

    // Load persisted chat history for AI (if not already in memory)
    await loadRoomChatHistory(roomId);

    const { snapshot, memberCount } = joinRoom(roomId, socket);

    // Notify other members in the room that a new peer joined
    socket.to(roomId).emit('room:peer_joined', { socketId: socket.id });

    // Send existing canvas state and peer count (excluding self) to the joining client
    socket.emit('room:snapshot', { snapshot, peerCount: memberCount - 1 });

    // Send existing chat history to the joining client
    const chatHistory = getRoomChatHistory(roomId);
    if (chatHistory.length > 0) {
      socket.emit('ai_chat_history', { messages: chatHistory });
    }

    console.log(`[socket] ${socket.id} → join_room "${roomId}" (user: ${userId}), snapshot=${snapshot ? 'yes' : 'null'}, peerCount=${memberCount - 1}`);
  });

  // ---- canvas:snapshot -------------------------------------------
  // Full canvas state sent by the first/lead client.
  // Payload: { roomId: string; snapshot: string }
  socket.on('canvas:snapshot', ({ roomId, snapshot }: { roomId: string; snapshot: string }) => {
    if (!roomId || typeof snapshot !== 'string') return;
    setSnapshot(roomId, snapshot);
    // Fan out to everyone else in the room
    socket.to(roomId).emit('canvas:snapshot', { snapshot });

    // Schedule a debounced save to Upstash Redis
    scheduleRedisSave(roomId, snapshot);
  });

  // ---- canvas:mutation -------------------------------------------
  // Incremental object change broadcast.
  // Payload: { roomId: string; mutation: CanvasMutation }
  socket.on('canvas:mutation', ({ roomId, mutation }: { roomId: string; mutation: CanvasMutation }) => {
    if (!roomId || !mutation) return;
    // Fan out to everyone else in the room (not echo back to sender)
    socket.to(roomId).emit('canvas:mutation', { mutation });
    console.log(`[socket] ${socket.id} → mutation "${mutation.type}" in "${roomId}"`);
  });

  // ---- cursor:move -----------------------------------------------
  socket.on('cursor:move', ({ roomId, x, y, userId }: { roomId: string; x: number; y: number; userId: string }) => {
    if (!roomId) return;
    socket.volatile.to(roomId).emit('cursor:move', { userId, x, y });
  });

  // ---- cursor:leave ----------------------------------------------
  socket.on('cursor:leave', ({ roomId, userId }: { roomId: string; userId: string }) => {
    if (!roomId) return;
    socket.to(roomId).emit('cursor:leave', { userId });
  });

  // ---- cursor:click ----------------------------------------------
  socket.on('cursor:click', ({ roomId, x, y, userId }: { roomId: string; x: number; y: number; userId: string }) => {
    if (!roomId) return;
    socket.to(roomId).emit('cursor:click', { userId, x, y });
  });

  // ---- ai_prompt --------------------------------------------------
  socket.on('ai_prompt', (payload: { message: string; mode: 'chat' | 'generate'; roomId: string; userId: string }) => {
    handleAiPrompt(io, socket, payload);
  });

  // ---- disconnect ------------------------------------------------
  socket.on('disconnect', (reason) => {
    const roomId = socketRooms.get(socket.id);
    const userId = socketUsers.get(socket.id);
    if (roomId) {
      leaveRoom(roomId, socket);
      socketRooms.delete(socket.id);
      socketUsers.delete(socket.id);
      io.to(roomId).emit('room:peer_left', { socketId: socket.id, userId });

      // If room is now empty, clean up AI state (flush to Redis)
      if (!hasRoom(roomId)) {
        cleanupRoomAi(roomId).catch(() => {});
      }
    }
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
  });
});

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`\n🟢 Synapse server running at http://localhost:${PORT}`);
  console.log(`   Accepting connections from: ${CLIENT_ORIGIN}\n`);
});
// Trigger reload
