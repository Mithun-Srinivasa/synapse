// redis.ts -- Upstash Redis client with Gzip compression & graceful fallback
// Phase 4: Persistence layer

import { Redis } from '@upstash/redis';
import zlib from 'zlib';

let redis: Redis | null = null;

// Graceful fallback if credentials are not provided (e.g. local dev)
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('🔌 [Redis] Connected to Upstash Redis REST API');
} else {
  console.warn(
    '⚠️ [Redis] Upstash Redis credentials not configured. Running strictly IN-MEMORY (no persistence).'
  );
}

/** Compress JSON string to base64-gzipped format */
export function compressDocument(str: string): string {
  const buffer = zlib.gzipSync(Buffer.from(str, 'utf-8'));
  return buffer.toString('base64');
}

/** Decompress base64-gzipped format back to JSON string */
export function decompressDocument(base64: string): string {
  const buffer = Buffer.from(base64, 'base64');
  return zlib.gunzipSync(buffer).toString('utf-8');
}

/**
 * Fetch board state from Redis, decompressing it on return.
 * Returns null if Redis is disabled, key not found, or error occurs.
 */
export async function getPersistedSnapshot(roomId: string): Promise<string | null> {
  if (!redis) return null;
  try {
    const data = await redis.get<string>(`board:${roomId}`);
    if (!data) return null;
    return decompressDocument(data);
  } catch (err) {
    console.error(`❌ [Redis] Error loading board "${roomId}":`, err);
    return null;
  }
}

/**
 * Save board state to Redis with Gzip compression and a 30-day TTL.
 * TTL resets on every save.
 */
export async function savePersistedSnapshot(roomId: string, snapshot: string): Promise<void> {
  if (!redis) return;
  try {
    const compressed = compressDocument(snapshot);
    // 30 days TTL (30 * 24 * 60 * 60 = 2,592,000 seconds)
    await redis.set(`board:${roomId}`, compressed, { ex: 2592000 });
    console.log(
      `💾 [Redis] Saved board "${roomId}" successfully: ${snapshot.length} chars -> ${compressed.length} bytes (gzipped/base64)`
    );
  } catch (err) {
    console.error(`❌ [Redis] Error saving board "${roomId}":`, err);
  }
}
