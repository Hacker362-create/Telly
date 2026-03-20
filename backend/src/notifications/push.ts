// src/notifications/push.ts
// Push notification service for the Telly VoIP platform.
//
// Supports two channels:
//   FCM  – Firebase Cloud Messaging for Android (and React-Native Firebase on iOS)
//   APNs – Apple Push Notification service for native iOS via HTTP/2
//
// Device tokens are stored in Redis:
//   fcm:<userId>            – FCM token registered via Socket.io (backward-compat)
//   push:fcm:<userId>       – FCM token registered via REST API
//   push:apns:<userId>      – APNs token registered via REST API
//
// All token keys have a 30-day rolling TTL.

import axios from 'axios';
import * as crypto from 'crypto';
import * as http2 from 'http2';
import IORedis from 'ioredis';

const FCM_API_URL = 'https://fcm.googleapis.com/fcm/send';

// Read env vars at call-time so tests (and live config reloads) can override them.
function getFcmServerKey(): string { return process.env.FCM_SERVER_KEY ?? ''; }
function getApnsHost(): string { return process.env.APNS_HOST ?? 'api.push.apple.com'; }
function getApnsBundleId(): string { return process.env.APNS_BUNDLE_ID ?? ''; }
function getApnsKeyId(): string { return process.env.APNS_KEY_ID ?? ''; }
function getApnsTeamId(): string { return process.env.APNS_TEAM_ID ?? ''; }
function getApnsPrivateKey(): string { return process.env.APNS_PRIVATE_KEY ?? ''; }

// 30-day TTL for push tokens (in seconds)
const PUSH_TOKEN_TTL = 30 * 24 * 60 * 60;

export type PushPlatform = 'fcm' | 'apns';

export interface IncomingCallPayload {
  callId: string;
  callerId: string;
  callerName: string;
}

export interface MessagePushPayload {
  senderId: string;
  senderName: string;
  /** Truncated preview of the message body (max 100 chars). */
  preview: string;
}

export interface VoicemailPushPayload {
  callerId: string;
  callerName: string;
  durationSec: number;
}

interface RedisCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let _redis: RedisCache | null = null;

export function setPushRedisClient(client: RedisCache): void {
  _redis = client as RedisCache;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Return the push-service Redis client.
 * Falls back to creating a real IORedis client on first call when no
 * custom client has been injected (e.g. in production).
 */
function getRedis(): RedisCache {
  if (!_redis) {
    const client = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    _redis = client as RedisCache;
  }
  return _redis as RedisCache;
}

/**
 * Persist a device FCM token for a given user.
 * Called from the signaling server when the user sends their token.
 */
export async function storeDeviceToken(userId: string, fcmToken: string): Promise<void> {
  await getRedis().setex(`fcm:${userId}`, PUSH_TOKEN_TTL, fcmToken);
}

/**
 * Retrieve the stored FCM token for a user, or null if not found.
 */
export async function getDeviceToken(userId: string): Promise<string | null> {
  return getRedis().get(`fcm:${userId}`);
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
  if (!getFcmServerKey()) {
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
          Authorization: `key=${getFcmServerKey()}`,
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

// ── REST-registered token helpers ─────────────────────────────────────────────

/**
 * Store a device token registered via the REST API under `push:<platform>:<userId>`.
 * Used by `POST /push-tokens`.
 */
export async function storeTokenForPlatform(
  userId: string,
  token: string,
  platform: PushPlatform,
): Promise<void> {
  await getRedis().setex(`push:${platform}:${userId}`, PUSH_TOKEN_TTL, token);
}

/**
 * Remove a device token registered via the REST API.
 * Used by `DELETE /push-tokens`.
 */
export async function deleteTokenForPlatform(
  userId: string,
  platform: PushPlatform,
): Promise<void> {
  await getRedis().del(`push:${platform}:${userId}`);
}

/**
 * Retrieve the FCM token for a user, checking the REST-registered key first
 * then falling back to the socket-registered key (backward-compat).
 */
async function resolveFcmToken(userId: string): Promise<string | null> {
  const restToken = await getRedis().get(`push:fcm:${userId}`);
  if (restToken) return restToken;
  return getRedis().get(`fcm:${userId}`);
}

// ── APNs via HTTP/2 ──────────────────────────────────────────────────────────

/**
 * Build a short-lived APNs JWT (valid for 1 hour).
 * Requires APNS_PRIVATE_KEY (PEM), APNS_KEY_ID and APNS_TEAM_ID.
 */
function generateApnsJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: getApnsKeyId() })).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: getApnsTeamId(), iat })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(sigInput);
  const sig = sign.sign(
    { key: getApnsPrivateKey(), dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return `${sigInput}.${sig}`;
}

interface ApnsNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send a single push notification via APNs HTTP/2.
 * Opens and immediately closes a connection per push (acceptable for low
 * volume; a connection-pool can be added later).
 */
export async function sendApnsPush(
  deviceToken: string,
  notification: ApnsNotification,
): Promise<void> {
  if (!getApnsBundleId() || !getApnsKeyId() || !getApnsTeamId() || !getApnsPrivateKey()) {
    console.warn('[Push] APNs not configured — skipping push');
    return;
  }

  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: 'default',
    },
    ...notification.data,
  });

  await new Promise<void>((resolve, reject) => {
    const client = http2.connect(`https://${getApnsHost()}`);

    client.once('error', (err: Error) => {
      client.destroy();
      reject(err);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-topic': getApnsBundleId(),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      authorization: `bearer ${generateApnsJwt()}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(apnsPayload),
    });

    req.write(apnsPayload);
    req.end();

    req.once('response', (headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader) => {
      client.close();
      const status = headers[':status'];
      if (status === 200) {
        resolve();
      } else {
        reject(new Error(`APNs returned status ${status}`));
      }
    });

    req.once('error', (err: Error) => {
      client.destroy();
      reject(err);
    });
  });
}

// ── Multi-platform notification helpers ───────────────────────────────────────

/**
 * Send a "new message" push notification to a user's registered devices.
 * Silently skips unavailable channels (no token / service not configured).
 */
export async function sendNewMessagePush(
  recipientId: string,
  payload: MessagePushPayload,
): Promise<void> {
  const preview = payload.preview.substring(0, 100);
  const title = `New message from ${payload.senderName}`;

  const fcmToken = await resolveFcmToken(recipientId);
  const apnsToken = await getRedis().get(`push:apns:${recipientId}`);

  const tasks: Promise<void>[] = [];

  if (fcmToken && getFcmServerKey()) {
    tasks.push(
      axios.post(
        FCM_API_URL,
        {
          to: fcmToken,
          priority: 'high',
          notification: { title, body: preview },
          data: { type: 'NEW_MESSAGE', senderId: payload.senderId, senderName: payload.senderName },
        },
        {
          headers: { Authorization: `key=${getFcmServerKey()}`, 'Content-Type': 'application/json' },
          timeout: 5000,
        },
      ).then(() => undefined).catch((err: unknown) => {
        console.error('[Push] FCM new-message push failed:', err);
      }),
    );
  }

  if (apnsToken) {
    tasks.push(
      sendApnsPush(apnsToken, {
        title,
        body: preview,
        data: { type: 'NEW_MESSAGE', senderId: payload.senderId },
      }).catch((err: unknown) => {
        console.error('[Push] APNs new-message push failed:', err);
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Send a "new voicemail" push notification to a user's registered devices.
 * Silently skips unavailable channels (no token / service not configured).
 */
export async function sendNewVoicemailPush(
  recipientId: string,
  payload: VoicemailPushPayload,
): Promise<void> {
  const title = `New voicemail from ${payload.callerName}`;
  const body = `${payload.durationSec}s voicemail — tap to listen`;

  const fcmToken = await resolveFcmToken(recipientId);
  const apnsToken = await getRedis().get(`push:apns:${recipientId}`);

  const tasks: Promise<void>[] = [];

  if (fcmToken && getFcmServerKey()) {
    tasks.push(
      axios.post(
        FCM_API_URL,
        {
          to: fcmToken,
          priority: 'high',
          notification: { title, body },
          data: { type: 'NEW_VOICEMAIL', callerId: payload.callerId, callerName: payload.callerName },
        },
        {
          headers: { Authorization: `key=${getFcmServerKey()}`, 'Content-Type': 'application/json' },
          timeout: 5000,
        },
      ).then(() => undefined).catch((err: unknown) => {
        console.error('[Push] FCM new-voicemail push failed:', err);
      }),
    );
  }

  if (apnsToken) {
    tasks.push(
      sendApnsPush(apnsToken, {
        title,
        body,
        data: { type: 'NEW_VOICEMAIL', callerId: payload.callerId },
      }).catch((err: unknown) => {
        console.error('[Push] APNs new-voicemail push failed:', err);
      }),
    );
  }

  await Promise.all(tasks);
}

