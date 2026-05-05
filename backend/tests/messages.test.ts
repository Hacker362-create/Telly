// tests/messages.test.ts
// Unit tests for the in-app messaging REST API.
//   POST   /messages
//   GET    /messages/conversation/:peerId
//   PATCH  /messages/:id/read
//   GET    /messages/unread/count
//
// PrismaClient is fully mocked so no database is required.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import messagesRouter from '../src/routes/messages';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'sender-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Prisma mock ────────────────────────────────────────────────────────────────
jest.mock('@prisma/client', () => {
  const message = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({ message })),
    __message: message,
  };
});

// Also mock the metrics registry so no duplicate prom-client metrics
jest.mock('../src/metrics/registry', () => ({
  messagesSentCounter: { inc: jest.fn() },
}));

// Mock push notifications so no Redis/FCM calls happen in route tests
jest.mock('../src/notifications/push', () => ({
  sendNewMessagePush: jest.fn().mockResolvedValue(undefined),
}));

function db() {
  return (jest.requireMock('@prisma/client') as { __message: Record<string, jest.Mock> }).__message;
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/messages', messagesRouter);
  return app;
}

const NOW = '2026-03-20T06:00:00.000Z';
const SAMPLE_MSG = {
  id: 'msg-1',
  senderId: 'sender-user',
  recipientId: 'peer-user',
  body: 'Hello!',
  sentAt: NOW,
};

// ── POST /messages ─────────────────────────────────────────────────────────────
describe('POST /messages', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db().create.mockResolvedValue(SAMPLE_MSG);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/messages')
      .send({ recipientId: 'peer-user', body: 'Hi' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when recipientId is missing', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ body: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientId/i);
  });

  it('returns 400 when body is missing', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'peer-user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body/i);
  });

  it('returns 400 when body is empty string', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'peer-user', body: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body exceeds 4000 characters', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'peer-user', body: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/4000/);
  });

  it('returns 400 when sender tries to message themselves', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'sender-user', body: 'Hi me' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('returns 201 and the created message on success', async () => {
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'peer-user', body: 'Hello!' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'msg-1', senderId: 'sender-user', body: 'Hello!' });
  });

  it('trims whitespace from body', async () => {
    await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({ recipientId: 'peer-user', body: '  Hello  ' });
    const createCall = db().create.mock.calls[0][0];
    expect(createCall.data.body).toBe('Hello');
  });
});

// ── GET /messages/unread/count ─────────────────────────────────────────────────
describe('GET /messages/unread/count', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db().count.mockResolvedValue(3);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/messages/unread/count');
    expect(res.status).toBe(401);
  });

  it('returns 200 with unreadCount', async () => {
    const res = await request(app)
      .get('/messages/unread/count')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 3 });
  });

  it('filters by recipientId = userId and readAt = null', async () => {
    await request(app)
      .get('/messages/unread/count')
      .set('Authorization', `Bearer ${token()}`)
    const countCall = db().count.mock.calls[0][0];
    expect(countCall.where).toMatchObject({ recipientId: 'sender-user', readAt: null });
  });
});

// ── GET /messages/conversation/:peerId ────────────────────────────────────────
describe('GET /messages/conversation/:peerId', () => {
  const app = makeApp();

  const MSGS = [SAMPLE_MSG, { ...SAMPLE_MSG, id: 'msg-2', body: 'World' }];

  beforeEach(() => {
    jest.clearAllMocks();
    db().count.mockResolvedValue(2);
    db().findMany.mockResolvedValue(MSGS);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/messages/conversation/peer-user');
    expect(res.status).toBe(401);
  });

  it('returns 200 with messages and pagination', async () => {
    const res = await request(app)
      .get('/messages/conversation/peer-user')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('messages');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages).toHaveLength(2);
  });

  it('includes correct pagination metadata', async () => {
    const res = await request(app)
      .get('/messages/conversation/peer-user?page=1&limit=20')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 2, pages: 1, hasMore: false });
  });

  it('queries both directions (sender→peer and peer→sender)', async () => {
    await request(app)
      .get('/messages/conversation/peer-user')
      .set('Authorization', `Bearer ${token()}`)
    const findCall = db().findMany.mock.calls[0][0];
    expect(findCall.where.OR).toEqual([
      { senderId: 'sender-user', recipientId: 'peer-user' },
      { senderId: 'peer-user', recipientId: 'sender-user' },
    ]);
  });

  it('respects page and limit query params', async () => {
    db().count.mockResolvedValue(100);
    const res = await request(app)
      .get('/messages/conversation/peer-user?page=3&limit=10')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.body.pagination.page).toBe(3);
    expect(res.body.pagination.limit).toBe(10);
  });

  it('clamps limit to MAX_PAGE_SIZE (50)', async () => {
    await request(app)
      .get('/messages/conversation/peer-user?limit=9999')
      .set('Authorization', `Bearer ${token()}`)
    const findCall = db().findMany.mock.calls[0][0];
    expect(findCall.take).toBe(50);
  });
});

// ── PATCH /messages/:id/read ──────────────────────────────────────────────────
describe('PATCH /messages/:id/read', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).patch('/messages/msg-1/read');
    expect(res.status).toBe(401);
  });

  it('returns 404 when message does not exist', async () => {
    db().findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch('/messages/missing-msg/read')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the recipient', async () => {
    db().findUnique.mockResolvedValue({ id: 'msg-1', recipientId: 'other-user', readAt: null });
    const res = await request(app)
      .patch('/messages/msg-1/read')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(403);
  });

  it('returns 409 when message is already read', async () => {
    db().findUnique.mockResolvedValue({ id: 'msg-1', recipientId: 'sender-user', readAt: NOW });
    const res = await request(app)
      .patch('/messages/msg-1/read')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('readAt');
  });

  it('returns 200 and sets readAt on success', async () => {
    db().findUnique.mockResolvedValue({ id: 'msg-1', recipientId: 'sender-user', readAt: null });
    db().update.mockResolvedValue({ id: 'msg-1', readAt: NOW });
    const res = await request(app)
      .patch('/messages/msg-1/read')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'msg-1');
    expect(res.body).toHaveProperty('readAt');
  });

  it('calls update with readAt as a Date', async () => {
    db().findUnique.mockResolvedValue({ id: 'msg-1', recipientId: 'sender-user', readAt: null });
    db().update.mockResolvedValue({ id: 'msg-1', readAt: new Date() });
    await request(app)
      .patch('/messages/msg-1/read')
      .set('Authorization', `Bearer ${token()}`)
    const updateCall = db().update.mock.calls[0][0];
    expect(updateCall.data.readAt).toBeInstanceOf(Date);
  });
});
