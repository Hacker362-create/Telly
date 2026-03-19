// src/signaling/Gatekeeper.ts
// Subscription gate middleware: validates active KES 500/month M-Pesa subscription
// before allowing any socket connection to proceed.

import type { Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { Redis as IORedis } from 'ioredis';

const prisma = new PrismaClient();

// Allow injection of a custom Redis client for testing
let redisClient: IORedis | null = null;

export function setRedisClient(client: IORedis): void {
  redisClient = client;
}

export function getRedisClient(): IORedis {
  if (!redisClient) {
    redisClient = new (require('ioredis'))({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false,
    });
  }
  return redisClient as IORedis;
}

export interface AuthPayload {
  userId: string;
  token?: string;
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
    const cached = await (redis as unknown as { get(key: string): Promise<string | null> }).get(cacheKey);

    if (cached === 'active') {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, subscriptionExpiry: true },
    });

    if (!user?.isActive || user.subscriptionExpiry < new Date()) {
      return next(new Error('TELLY_LINE_INACTIVE'));
    }

    // Cache active status for 60 seconds to reduce DB load
    await (redis as unknown as { setex(key: string, ttl: number, value: string): Promise<unknown> }).setex(cacheKey, 60, 'active');
    next();
  } catch (err) {
    next(new Error('TELLY_INTERNAL_ERROR'));
  }
}
