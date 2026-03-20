// tests/presence.test.ts
// Unit tests for the user presence REST API.
//   GET  /presence/:userId
//   POST /presence/batch
//
// The PresenceStore is mocked so no Redis connection is needed.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import presenceRouter from '../src/routes/presence';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'caller-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── PresenceStore mock ─────────────────────────────────────────────────────────
jest.mock('../src/presence/PresenceStore', () => {
  const getPresence = jest.fn();
  const getPresenceBatch = jest.fn();
  const setPresence = jest.fn();
  const clearPresence = jest.fn();
  return {
    getPresence,
    getPresenceBatch,
    setPresence,
    clearPresence,
    PRESENCE_TTL_S: 90,
    __getPresence: getPresence,
    __getPresenceBatch: getPresenceBatch,
  };
});

function mocks() {
  return jest.requireMock('../src/presence/PresenceStore') as {
    __getPresence: jest.Mock;
    __getPresenceBatch: jest.Mock;
  };
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/presence', presenceRouter);
  return app;
}

const ONLINE_RECORD = { status: 'online', updatedAt: '2026-03-20T06:00:00.000Z' };
const OFFLINE_RECORD = { status: 'offline', updatedAt: '2026-03-20T06:00:00.000Z' };

// ── GET /presence/:userId ──────────────────────────────────────────────────────
describe('GET /presence/:userId', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mocks().__getPresence.mockResolvedValue(ONLINE_RECORD);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/presence/user-a');
    expect(res.status).toBe(401);
  });

  it('returns 200 with presence record for a known online user', async () => {
    const res = await request(app)
      .get('/presence/user-a')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: 'user-a', status: 'online' });
    expect(res.body).toHaveProperty('updatedAt');
  });

  it('returns status offline for an unknown/expired user', async () => {
    mocks().__getPresence.mockResolvedValue(OFFLINE_RECORD);

    const res = await request(app)
      .get('/presence/ghost-user')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
  });

  it('passes the requested userId to getPresence', async () => {
    await request(app)
      .get('/presence/target-123')
      .set('Authorization', `Bearer ${token()}`);

    expect(mocks().__getPresence).toHaveBeenCalledWith('target-123');
  });

  it('returns busy status', async () => {
    mocks().__getPresence.mockResolvedValue({ status: 'busy', updatedAt: '2026-03-20T06:00:00.000Z' });

    const res = await request(app)
      .get('/presence/caller-user')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('busy');
  });

  it('returns away status', async () => {
    mocks().__getPresence.mockResolvedValue({ status: 'away', updatedAt: '2026-03-20T06:00:00.000Z' });

    const res = await request(app)
      .get('/presence/some-user')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('away');
  });
});

// ── POST /presence/batch ───────────────────────────────────────────────────────
describe('POST /presence/batch', () => {
  const app = makeApp();

  const BATCH_RESULT = {
    'user-a': { status: 'online', updatedAt: '2026-03-20T06:00:00.000Z' },
    'user-b': { status: 'offline', updatedAt: '2026-03-20T06:00:00.000Z' },
    'user-c': { status: 'busy', updatedAt: '2026-03-20T06:00:00.000Z' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mocks().__getPresenceBatch.mockResolvedValue(BATCH_RESULT);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .send({ userIds: ['user-a'] });
    expect(res.status).toBe(401);
  });

  it('returns 400 when userIds is not an array', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: 'user-a' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it('returns 400 when userIds is missing', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns empty presence object for empty userIds array', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presence: {} });
    expect(mocks().__getPresenceBatch).not.toHaveBeenCalled();
  });

  it('returns 400 when userIds exceeds 100 entries', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `user-${i}`);
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100/);
  });

  it('returns 400 when userIds contains a non-string entry', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: ['user-a', 42, 'user-b'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/i);
  });

  it('returns presence map for valid userIds', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: ['user-a', 'user-b', 'user-c'] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('presence');
    expect(res.body.presence['user-a'].status).toBe('online');
    expect(res.body.presence['user-b'].status).toBe('offline');
    expect(res.body.presence['user-c'].status).toBe('busy');
  });

  it('passes userIds to getPresenceBatch', async () => {
    const ids = ['user-x', 'user-y'];
    await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: ids });

    expect(mocks().__getPresenceBatch).toHaveBeenCalledWith(ids);
  });

  it('returns 400 when userIds contains an empty-string entry', async () => {
    const res = await request(app)
      .post('/presence/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userIds: ['user-a', ''] });
    expect(res.status).toBe(400);
  });
});
