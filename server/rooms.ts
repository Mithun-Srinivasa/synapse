// rooms.ts -- in-memory room state (Option A: server holds full canvas snapshot)
// Phase 4: Room state manager with Redis persistence hooks

import type { Socket } from 'socket.io';
import { forceFlushRedisSave } from './debounce';

interface RoomState {
  /** Latest full Fabric.js JSON snapshot of the canvas (stringified). */
  snapshot: string | null;
  /** Active socket IDs in this room. */
  members: Set<string>;
}

const rooms = new Map<string, RoomState>();

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function getOrCreate(roomId: string): RoomState {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { snapshot: null, members: new Set() });
  }
  return rooms.get(roomId)!;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/** Check if the room exists in memory. */
export function hasRoom(roomId: string): boolean {
  return rooms.has(roomId);
}

export function joinRoom(roomId: string, socket: Socket): { snapshot: string | null; memberCount: number } {
  const room = getOrCreate(roomId);
  room.members.add(socket.id);
  socket.join(roomId);
  console.log(`[room] ${socket.id} joined "${roomId}" (${room.members.size} member(s))`);
  return { snapshot: room.snapshot, memberCount: room.members.size };
}

export function leaveRoom(roomId: string, socket: Socket): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(socket.id);
  socket.leave(roomId);
  console.log(`[room] ${socket.id} left "${roomId}" (${room.members.size} member(s) remaining)`);
  
  // Clean up rooms with no members to free memory and flush to DB
  if (room.members.size === 0) {
    const lastSnapshot = room.snapshot;
    rooms.delete(roomId);
    console.log(`[room] "${roomId}" destroyed (empty)`);
    
    if (lastSnapshot) {
      forceFlushRedisSave(roomId, lastSnapshot);
    }
  }
}

export function setSnapshot(roomId: string, snapshot: string): void {
  const room = getOrCreate(roomId);
  room.snapshot = snapshot;
}

export function getSnapshot(roomId: string): string | null {
  return rooms.get(roomId)?.snapshot ?? null;
}

export function getRoomIds(): string[] {
  return Array.from(rooms.keys());
}
