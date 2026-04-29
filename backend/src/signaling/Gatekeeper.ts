// src/signaling/Gatekeeper.ts
// Subscription gate middleware: validates subscription or free-tier daily limit
// before allowing any socket connection to proceed.

import type { Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';

const prisma = new PrismaClient();

interface RedisCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
}

// Allow injection of a custom Redis client for testing
let redisClient: RedisCache | null = null;

export function setRedisClient(client: RedisCache): void {
  redisClient = client;
}

export function getRedisClient(): RedisCache {
  if (!redisClient) {
    redisClient = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false,
    });
  }
  return redisClient;
}

export interface AuthPayload {
  userId: string;
  token?: string;
}

const GRACE_PERIOD_HOURS = parseInt(process.env.SUBSCRIPTION_GRACE_HOURS ?? '0', 10);
const DAILY_FREE_MINUTES = parseInt(process.env.DAILY_FREE_MINUTES ?? '15', 10);

/**
 * Returns true if the user has not yet exhausted their daily free-tier minutes.
 * Bonus minutes (from referrals) are used after daily free minutes.
 * Resets the counter if lastResetDate is not today (UTC).
 */
async function isWithinFreeTier(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyMinutesUsed: true, lastResetDate: true, bonusMinutes: true },
  });
  if (!user) return false;

  const now = new Date();
  const lastReset = user.lastResetDate ? new Date(user.lastResetDate) : null;
  const isNewDay =
    !lastReset ||
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth() ||
    lastReset.getUTCDate() !== now.getUTCDate();

  const minutesUsed = isNewDay ? 0 : user.dailyMinutesUsed;
  const bonusMinutes = user.bonusMinutes ?? 0;
  return minutesUsed < DAILY_FREE_MINUTES || bonusMinutes > 0;
}

/**
 * Socket.io middleware that enforces subscription status.
 * A user with an expired or inactive subscription is disconnected
 * with the error code TELLY_LINE_INACTIVE.
 */
export async function gatekeeperMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  const { userId } = socket.handshake.auth as AuthPayload;

  if (!userId) {
    return next(new Error('TELLY_AUTH_MISSING'));
  }

  try {
    // Check Redis cache first to reduce DB load
    const redis = getRedisClient();
    const cacheKey = `subscription:${userId}`;
    const cached = await redis.get(cacheKey);

    if (cached === 'active') {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, subscriptionExpiry: true, dailyMinutesUsed: true, lastResetDate: true },
    });

    if (!user) {
      return next(new Error('TELLY_LINE_INACTIVE'));
    }

    const now = new Date();
    const expiry = new Date(user.subscriptionExpiry);
    const expiryValid = !Number.isNaN(expiry.getTime());
    const graceDeadline = expiryValid ? new Date(expiry) : new Date(0);
    graceDeadline.setHours(graceDeadline.getHours() + Math.max(0, GRACE_PERIOD_HOURS));

    const isFullySubscribed = user.isActive && expiryValid && expiry >= now;
    const isInGrace = user.isActive && expiryValid && expiry < now && graceDeadline >= now;

    if (isFullySubscribed || isInGrace) {
      const mutableSocket = socket as Socket & { data?: Record<string, unknown> };
      mutableSocket.data = mutableSocket.data ?? {};
      if (isInGrace) {
        mutableSocket.data.subscriptionInGrace = true;
      }
      // Cache active/grace status for 60 seconds to reduce DB load
      await redis.setex(cacheKey, 60, 'active');
      return next();
    }

    // Not subscribed — check free-tier daily limit
    const lastReset = user.lastResetDate ? new Date(user.lastResetDate) : null;
    const isNewDay =
      !lastReset ||
      lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
      lastReset.getUTCMonth() !== now.getUTCMonth() ||
      lastReset.getUTCDate() !== now.getUTCDate();
    const minutesUsed = isNewDay ? 0 : user.dailyMinutesUsed;

    if (minutesUsed < DAILY_FREE_MINUTES) {
      const mutableSocket = socket as Socket & { data?: Record<string, unknown> };
      mutableSocket.data = mutableSocket.data ?? {};
      mutableSocket.data.freeTier = true;
      mutableSocket.data.freeMinutesRemaining = DAILY_FREE_MINUTES - minutesUsed;
      return next();
    }

    return next(new Error('TELLY_LINE_INACTIVE'));
  } catch (err) {
    next(new Error('TELLY_INTERNAL_ERROR'));
  }
}
