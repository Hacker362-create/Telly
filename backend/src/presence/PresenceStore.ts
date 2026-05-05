// src/presence/PresenceStore.ts
// Redis-backed presence store for Telly VoIP.
//
// Each user's status is stored under the key `presence:<userId>` as a JSON
// string with the shape { status, updatedAt }.  A 90-second TTL is applied so
// stale entries expire automatically — the signaling server refreshes it every
// 60 s via `presence:heartbeat` events.
//
// Supported statuses:
//   online  – connected and available to receive calls
//   busy    – in an active call
//   away    – connected but manually set to away
//   offline – disconnected (key deleted or TTL expired)

import IORedis from 'ioredis';

export type PresenceStatus = 'online' | 'busy' | 'away' | 'offline';

export interface PresenceRecord {
  status: PresenceStatus;
  updatedAt: string; // ISO-8601
}

// Heartbeat TTL in seconds. The client must send a heartbeat at most every
// HEARTBEAT_INTERVAL_S seconds to keep the record alive.
export const PRESENCE_TTL_S = 90;

interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let _redis: RedisClient | null = null;

/** Inject a custom Redis client (used in tests to avoid real connections). */
export function setPresenceRedisClient(client: RedisClient): void {
  _redis = client;
}

function getRedis(): RedisClient {
  if (!_redis) {
    _redis = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false,
    });
  }
  return _redis;
}

function presenceKey(userId: string): string {
  return `presence:${userId}`;
}

/**
 * Write a presence record for a user.
 * TTL is reset to PRESENCE_TTL_S on every write.
 */
export async function setPresence(
  userId: string,
  status: PresenceStatus,
): Promise<void> {
  const record: PresenceRecord = { status, updatedAt: new Date().toISOString() };
  await getRedis().setex(presenceKey(userId), PRESENCE_TTL_S, JSON.stringify(record));
}

/**
 * Read the current presence of a user.
 * Returns an 'offline' record when the key has expired or was never set.
 */
export async function getPresence(userId: string): Promise<PresenceRecord> {
  const raw = await getRedis().get(presenceKey(userId));
  if (!raw) {
    return { status: 'offline', updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(raw) as PresenceRecord;
  } catch {
    return { status: 'offline', updatedAt: new Date().toISOString() };
  }
}

/**
 * Explicitly remove a user's presence record (called on socket disconnect).
 * This gives instant offline visibility rather than waiting for TTL.
 */
export async function clearPresence(userId: string): Promise<void> {
  await getRedis().del(presenceKey(userId));
}

/**
 * Bulk-fetch presence for a list of user IDs.
 * Returns a map of userId → PresenceRecord; absent keys get 'offline'.
 */
export async function getPresenceBatch(
  userIds: string[],
): Promise<Record<string, PresenceRecord>> {
  const result: Record<string, PresenceRecord> = {};
  await Promise.all(
    userIds.map(async (id) => {
      result[id] = await getPresence(id);
    }),
  );
  return result;
}
