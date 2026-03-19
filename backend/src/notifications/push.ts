// src/notifications/push.ts
// FCM push notification service for background call wake-up.
// Uses the FCM HTTP v1 API (via axios) to send a data-only "incoming call" push
// to iOS and Android even when the Telly app is fully closed or in battery saver.
//
// Device tokens are stored in Redis under fcm:<userId> when the user connects to
// the signaling server. They are automatically evicted after 30 days if not refreshed.

import axios from 'axios';

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY ?? '';
const FCM_API_URL = 'https://fcm.googleapis.com/fcm/send';

// 30-day TTL for push tokens (in seconds)
const PUSH_TOKEN_TTL = 30 * 24 * 60 * 60;

export interface IncomingCallPayload {
  callId: string;
  callerId: string;
  callerName: string;
}

interface RedisCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
}

let _redis: RedisCache | null = null;

export function setPushRedisClient(client: RedisCache): void {
  _redis = client;
}

function getRedis(): RedisCache | null {
  return _redis;
}

/**
 * Persist a device FCM token for a given user.
 * Called from the signaling server when the user sends their token.
 */
export async function storeDeviceToken(userId: string, fcmToken: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.setex(`fcm:${userId}`, PUSH_TOKEN_TTL, fcmToken);
}

/**
 * Retrieve the stored FCM token for a user, or null if not found.
 */
export async function getDeviceToken(userId: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(`fcm:${userId}`);
}

/**
 * Send an "incoming call" push notification to the callee's device.
 * The push wakes the app (via FCM high-priority data message) so CallKit/
 * ConnectionService can present the native call UI to the user.
 *
 * Falls back silently if FCM is not configured (dev mode).
 */
export async function sendIncomingCallPush(
  calleeId: string,
  payload: IncomingCallPayload,
): Promise<void> {
  if (!FCM_SERVER_KEY) {
    console.warn('[Push] FCM_SERVER_KEY not configured — skipping push for', calleeId);
    return;
  }

  const token = await getDeviceToken(calleeId);
  if (!token) {
    console.warn('[Push] No FCM token found for user', calleeId);
    return;
  }

  try {
    await axios.post(
      FCM_API_URL,
      {
        to: token,
        priority: 'high',        // Wake device even in Doze mode
        content_available: true,  // iOS background wake-up
        data: {
          type: 'INCOMING_CALL',
          callId: payload.callId,
          callerId: payload.callerId,
          callerName: payload.callerName,
        },
      },
      {
        headers: {
          Authorization: `key=${FCM_SERVER_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
    );
    console.log('[Push] Incoming call push sent to user', calleeId);
  } catch (err) {
    console.error('[Push] Failed to send push notification:', err);
  }
}

