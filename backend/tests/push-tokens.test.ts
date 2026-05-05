// tests/push-tokens.test.ts
// Unit tests for:
//   POST   /push-tokens   – register device push token
//   DELETE /push-tokens   – deregister device push token
//   sendNewMessagePush    – fires FCM/APNs on new message
//   sendNewVoicemailPush  – fires FCM/APNs on new voicemail

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import pushTokensRouter from '../src/routes/push-tokens';
import {
  storeTokenForPlatform,
  deleteTokenForPlatform,
  sendNewMessagePush,
  sendNewVoicemailPush,
  setPushRedisClient,
} from '../src/notifications/push';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'user-push'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../src/metrics/registry', () => ({
  pushTokensRegisteredCounter: { inc: jest.fn() },
  messagesSentCounter: { inc: jest.fn() },
  voicemailsLeftCounter: { inc: jest.fn() },
}));

// Mock axios to avoid real HTTP calls
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200, data: {} }),
}));

// ── Shared in-memory Redis mock ────────────────────────────────────────────────

function makeMockRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

let mockRedis: ReturnType<typeof makeMockRedis>;

beforeEach(() => {
  mockRedis = makeMockRedis();
  setPushRedisClient(mockRedis);
  jest.clearAllMocks();
});

// ── Express app ────────────────────────────────────────────────────────────────

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/push-tokens', pushTokensRouter);
  return app;
}

// ── POST /push-tokens ──────────────────────────────────────────────────────────

describe('POST /push-tokens', () => {
  const app = makeApp();

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .send({ token: 'abc', platform: 'fcm' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ platform: 'fcm' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('returns 400 when token is blank', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ token: '   ', platform: 'fcm' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid platform', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ token: 'device-tok', platform: 'webpush' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('registers an FCM token and returns { ok: true }', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ token: 'fcm-device-token-123', platform: 'fcm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'push:fcm:user-push',
      expect.any(Number),
      'fcm-device-token-123',
    );
  });

  it('registers an APNs token and returns { ok: true }', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ token: 'apns-device-token-xyz', platform: 'apns' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'push:apns:user-push',
      expect.any(Number),
      'apns-device-token-xyz',
    );
  });

  it('trims leading/trailing whitespace from the token', async () => {
    const res = await request(app)
      .post('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ token: '  trimmed-token  ', platform: 'fcm' });
    expect(res.status).toBe(200);
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'push:fcm:user-push',
      expect.any(Number),
      'trimmed-token',
    );
  });
});

// ── DELETE /push-tokens ────────────────────────────────────────────────────────

describe('DELETE /push-tokens', () => {
  const app = makeApp();

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .delete('/push-tokens')
      .send({ platform: 'fcm' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid platform', async () => {
    const res = await request(app)
      .delete('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ platform: 'unknown' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('deregisters an FCM token and returns { ok: true }', async () => {
    // Pre-seed a token
    mockRedis.store.set('push:fcm:user-push', 'some-token');

    const res = await request(app)
      .delete('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ platform: 'fcm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRedis.del).toHaveBeenCalledWith('push:fcm:user-push');
    expect(mockRedis.store.has('push:fcm:user-push')).toBe(false);
  });

  it('deregisters an APNs token and returns { ok: true }', async () => {
    mockRedis.store.set('push:apns:user-push', 'apns-tok');

    const res = await request(app)
      .delete('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ platform: 'apns' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRedis.del).toHaveBeenCalledWith('push:apns:user-push');
  });

  it('succeeds silently even when no token was stored', async () => {
    const res = await request(app)
      .delete('/push-tokens')
      .set('Authorization', `Bearer ${token()}`)
      .send({ platform: 'fcm' });
    expect(res.status).toBe(200);
  });
});

// ── storeTokenForPlatform / deleteTokenForPlatform ─────────────────────────────

describe('storeTokenForPlatform and deleteTokenForPlatform', () => {
  it('stores a token under push:fcm:<userId>', async () => {
    await storeTokenForPlatform('alice', 'tok-fcm', 'fcm');
    expect(mockRedis.store.get('push:fcm:alice')).toBe('tok-fcm');
  });

  it('stores a token under push:apns:<userId>', async () => {
    await storeTokenForPlatform('bob', 'tok-apns', 'apns');
    expect(mockRedis.store.get('push:apns:bob')).toBe('tok-apns');
  });

  it('deletes a previously stored token', async () => {
    mockRedis.store.set('push:fcm:carol', 'old-token');
    await deleteTokenForPlatform('carol', 'fcm');
    expect(mockRedis.store.has('push:fcm:carol')).toBe(false);
  });
});

// ── sendNewMessagePush ─────────────────────────────────────────────────────────

describe('sendNewMessagePush', () => {
  it('resolves silently when no tokens are stored (no FCM key)', async () => {
    const origKey = process.env.FCM_SERVER_KEY;
    delete process.env.FCM_SERVER_KEY;
    await expect(
      sendNewMessagePush('no-token-user', {
        senderId: 'sender-1',
        senderName: 'Alice',
        preview: 'Hey there!',
      }),
    ).resolves.toBeUndefined();
    process.env.FCM_SERVER_KEY = origKey;
  });

  it('sends an FCM push when a REST-registered token exists', async () => {
    process.env.FCM_SERVER_KEY = 'test-key';
    mockRedis.store.set('push:fcm:recipient-1', 'fcm-token-R1');

    const axios = jest.requireMock('axios');
    await sendNewMessagePush('recipient-1', {
      senderId: 'sender-1',
      senderName: 'Alice',
      preview: 'Hello!',
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('fcm.googleapis.com'),
      expect.objectContaining({
        to: 'fcm-token-R1',
        data: expect.objectContaining({ type: 'NEW_MESSAGE' }),
      }),
      expect.any(Object),
    );
    delete process.env.FCM_SERVER_KEY;
  });

  it('falls back to the socket-registered FCM token', async () => {
    process.env.FCM_SERVER_KEY = 'test-key';
    // No REST token, only the legacy socket-registered token
    mockRedis.store.set('fcm:recipient-2', 'legacy-fcm-token');

    const axios = jest.requireMock('axios');
    await sendNewMessagePush('recipient-2', {
      senderId: 'sender-x',
      senderName: 'Bob',
      preview: 'Fallback test',
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('fcm.googleapis.com'),
      expect.objectContaining({ to: 'legacy-fcm-token' }),
      expect.any(Object),
    );
    delete process.env.FCM_SERVER_KEY;
  });

  it('truncates previews longer than 100 characters', async () => {
    process.env.FCM_SERVER_KEY = 'test-key';
    mockRedis.store.set('push:fcm:recipient-3', 'tok');
    const longBody = 'x'.repeat(200);

    const axios = jest.requireMock('axios');
    await sendNewMessagePush('recipient-3', {
      senderId: 'sender-y',
      senderName: 'Carol',
      preview: longBody,
    });

    const callArgs = (axios.post as jest.Mock).mock.calls[0];
    const body = callArgs[1];
    expect(body.notification.body.length).toBeLessThanOrEqual(100);
    delete process.env.FCM_SERVER_KEY;
  });
});

// ── sendNewVoicemailPush ───────────────────────────────────────────────────────

describe('sendNewVoicemailPush', () => {
  it('resolves silently when no tokens are stored', async () => {
    const origKey = process.env.FCM_SERVER_KEY;
    delete process.env.FCM_SERVER_KEY;
    await expect(
      sendNewVoicemailPush('no-token-user', {
        callerId: 'caller-1',
        callerName: 'Dave',
        durationSec: 45,
      }),
    ).resolves.toBeUndefined();
    process.env.FCM_SERVER_KEY = origKey;
  });

  it('sends an FCM push for a new voicemail', async () => {
    process.env.FCM_SERVER_KEY = 'test-key';
    mockRedis.store.set('push:fcm:recipient-vm', 'fcm-vm-token');

    const axios = jest.requireMock('axios');
    await sendNewVoicemailPush('recipient-vm', {
      callerId: 'caller-2',
      callerName: 'Eve',
      durationSec: 30,
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('fcm.googleapis.com'),
      expect.objectContaining({
        to: 'fcm-vm-token',
        data: expect.objectContaining({ type: 'NEW_VOICEMAIL', callerId: 'caller-2' }),
      }),
      expect.any(Object),
    );
    delete process.env.FCM_SERVER_KEY;
  });
});
