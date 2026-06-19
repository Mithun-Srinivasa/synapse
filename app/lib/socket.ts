// lib/socket.ts -- singleton Socket.io client
// Phase 2: connects to the Synapse backend server on port 3001.
//
// Usage:
//   import { connectToRoom, disconnectFromRoom, socket } from '@/lib/socket';

import { io, type Socket } from 'socket.io-client';

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

// Create the socket once (lazy connect -- won't open until connectToRoom)
let _socket: Socket | null = null;

function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SERVER_URL, {
      autoConnect: false,   // don't connect until we call connectToRoom
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionAttempts: Infinity,
    });
  }
  return _socket;
}

// ----------------------------------------------------------------
// Public helpers
// ----------------------------------------------------------------

/** Connect (or reconnect) and join a specific room. */
export function connectToRoom(roomId: string, userId?: string): Socket {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }
  // After connect (or if already connected) emit join_room
  const doJoin = () => socket.emit('join_room', { roomId, userId });
  if (socket.connected) {
    doJoin();
  } else {
    socket.once('connect', doJoin);
  }
  return socket;
}

/** Leave the current room and disconnect cleanly. */
export function disconnectFromRoom(): void {
  _socket?.disconnect();
}

/** Expose the socket instance for event listeners. */
export { getSocket as socket };
