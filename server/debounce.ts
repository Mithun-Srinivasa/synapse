// debounce.ts -- debounced Redis saves to optimize write counts
// Phase 4: Persistence Layer

import { savePersistedSnapshot } from './redis';

const saveTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Schedule a debounced save to Upstash Redis.
 * Writes to the database only after 3 seconds of inactivity for the room.
 */
export function scheduleRedisSave(roomId: string, snapshot: string) {
  // Clear any existing pending write for this room
  if (saveTimeouts.has(roomId)) {
    clearTimeout(saveTimeouts.get(roomId)!);
  }

  const timeout = setTimeout(async () => {
    saveTimeouts.delete(roomId);
    await savePersistedSnapshot(roomId, snapshot);
  }, 3000); // 3-second debounce

  saveTimeouts.set(roomId, timeout);
}

/**
 * Cancels any pending timeouts and forces an immediate save of the provided
 * room snapshot to Redis. Called when the last user leaves the room.
 */
export async function forceFlushRedisSave(roomId: string, snapshot: string): Promise<void> {
  if (saveTimeouts.has(roomId)) {
    clearTimeout(saveTimeouts.get(roomId)!);
    saveTimeouts.delete(roomId);
  }

  console.log(
    `🧹 [Redis] Room "${roomId}" became empty. Force-flushing latest snapshot immediately.`
  );
  await savePersistedSnapshot(roomId, snapshot);
}
