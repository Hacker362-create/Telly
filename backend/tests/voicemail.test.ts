// tests/voicemail.test.ts
// Unit tests for the voicemail REST API.
//   POST   /voicemail
//   GET    /voicemail
//   GET    /voicemail/unlistened/count
//   GET    /voicemail/:id
//   PATCH  /voicemail/:id/listen
//   DELETE /voicemail/:id
//
// PrismaClient is fully mocked so no database is required.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import voicemailRouter from '../src/routes/voicemail';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'recipient-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Prisma mock ────────────────────────────────────────────────────────────────
jest.mock('@prisma/client', () => {
  const voicemail = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({ voicemail })),
    __voicemail: voicemail,
  };
});

jest.mock('../src/metrics/registry', () => ({
  voicemailsLeftCounter: { inc: jest.fn() },
}));

// Mock push notifications so no Redis/FCM calls happen in route tests
jest.mock('../src/notifications/push', () => ({
  sendNewVoicemailPush: jest.fn().mockResolvedValue(undefined),
}));

function db() {
  return (jest.requireMock('@prisma/client') as { __voicemail: Record<string, jest.Mock> }).__voicemail;
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/voicemail', voicemailRouter);
  return app;
}

const NOW = '2026-03-20T10:00:00.000Z';
const SAMPLE_VM = {
  id: 'vm-1',
  callerId: 'caller-user',
  recipientId: 'recipient-user',
  audioUrl: 'https://cdn.telly.app/voicemail/vm-1.ogg',
  durationSec: 30,
  transcription: 'Hey, call me back.',
  leftAt: NOW,
  listenedAt: null,
};

// ── POST /voicemail ────────────────────────────────────────────────────────────
describe('POST /voicemail', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db().create.mockResolvedValue(SAMPLE_VM);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/voicemail')
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when recipientId is missing', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipientId/i);
  });

  it('returns 400 when caller tries to leave voicemail for themselves', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'caller-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('returns 400 when audioUrl is missing', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', durationSec: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audioUrl/i);
  });

  it('returns 400 when audioUrl exceeds 2048 characters', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/' + 'x'.repeat(2048), durationSec: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2048/);
  });

  it('returns 400 when durationSec is missing', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/durationSec/i);
  });

  it('returns 400 when durationSec is not a positive integer', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/durationSec/i);
  });

  it('returns 400 when durationSec exceeds 180 seconds', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 181 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/180/);
  });

  it('returns 400 when transcription is not a string', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30, transcription: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/transcription/i);
  });

  it('returns 201 and the created voicemail on success', async () => {
    const res = await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'vm-1',
      callerId: 'caller-user',
      recipientId: 'recipient-user',
      durationSec: 30,
    });
  });

  it('accepts an optional transcription', async () => {
    await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30, transcription: 'Call me back.' });
    const createCall = db().create.mock.calls[0][0];
    expect(createCall.data.transcription).toBe('Call me back.');
  });

  it('stores null when transcription is omitted', async () => {
    await request(app)
      .post('/voicemail')
      .set('Authorization', `Bearer ${token('caller-user')}`)
      .send({ recipientId: 'recipient-user', audioUrl: 'https://cdn.telly.app/vm.ogg', durationSec: 30 });
    const createCall = db().create.mock.calls[0][0];
    expect(createCall.data.transcription).toBeNull();
  });
});

// ── GET /voicemail/unlistened/count ────────────────────────────────────────────
describe('GET /voicemail/unlistened/count', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db().count.mockResolvedValue(2);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/voicemail/unlistened/count');
    expect(res.status).toBe(401);
  });

  it('returns 200 with unlistenedCount', async () => {
    const res = await request(app)
      .get('/voicemail/unlistened/count')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlistenedCount: 2 });
  });

  it('filters by recipientId = userId and listenedAt = null', async () => {
    await request(app)
      .get('/voicemail/unlistened/count')
      .set('Authorization', `Bearer ${token()}`);
    const countCall = db().count.mock.calls[0][0];
    expect(countCall.where).toMatchObject({ recipientId: 'recipient-user', listenedAt: null });
  });
});

// ── GET /voicemail ─────────────────────────────────────────────────────────────
describe('GET /voicemail', () => {
  const app = makeApp();
  const VMS = [SAMPLE_VM, { ...SAMPLE_VM, id: 'vm-2', durationSec: 15 }];

  beforeEach(() => {
    jest.clearAllMocks();
    db().count.mockResolvedValue(2);
    db().findMany.mockResolvedValue(VMS);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/voicemail');
    expect(res.status).toBe(401);
  });

  it('returns 200 with voicemails and pagination', async () => {
    const res = await request(app)
      .get('/voicemail')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('voicemails');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.voicemails)).toBe(true);
    expect(res.body.voicemails).toHaveLength(2);
  });

  it('includes correct pagination metadata', async () => {
    const res = await request(app)
      .get('/voicemail?page=1&limit=20')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 2, pages: 1, hasMore: false });
  });

  it('filters by recipientId = userId', async () => {
    await request(app)
      .get('/voicemail')
      .set('Authorization', `Bearer ${token()}`);
    const findCall = db().findMany.mock.calls[0][0];
    expect(findCall.where).toEqual({ recipientId: 'recipient-user' });
  });

  it('orders by leftAt desc', async () => {
    await request(app)
      .get('/voicemail')
      .set('Authorization', `Bearer ${token()}`);
    const findCall = db().findMany.mock.calls[0][0];
    expect(findCall.orderBy).toEqual({ leftAt: 'desc' });
  });

  it('clamps limit to MAX_PAGE_SIZE (50)', async () => {
    await request(app)
      .get('/voicemail?limit=9999')
      .set('Authorization', `Bearer ${token()}`);
    const findCall = db().findMany.mock.calls[0][0];
    expect(findCall.take).toBe(50);
  });

  it('returns hasMore = true when more pages exist', async () => {
    db().count.mockResolvedValue(100);
    const res = await request(app)
      .get('/voicemail?page=1&limit=10')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.body.pagination.hasMore).toBe(true);
  });
});

// ── GET /voicemail/:id ─────────────────────────────────────────────────────────
describe('GET /voicemail/:id', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/voicemail/vm-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when voicemail does not exist', async () => {
    db().findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/voicemail/missing-vm')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is neither sender nor recipient', async () => {
    db().findUnique.mockResolvedValue({ ...SAMPLE_VM, callerId: 'other-caller', recipientId: 'other-recipient' });
    const res = await request(app)
      .get('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 when caller is the recipient', async () => {
    db().findUnique.mockResolvedValue(SAMPLE_VM);
    const res = await request(app)
      .get('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token('recipient-user')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('vm-1');
  });

  it('returns 200 when caller is the voicemail sender', async () => {
    db().findUnique.mockResolvedValue(SAMPLE_VM);
    const res = await request(app)
      .get('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token('caller-user')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('vm-1');
  });
});

// ── PATCH /voicemail/:id/listen ────────────────────────────────────────────────
describe('PATCH /voicemail/:id/listen', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).patch('/voicemail/vm-1/listen');
    expect(res.status).toBe(401);
  });

  it('returns 404 when voicemail does not exist', async () => {
    db().findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch('/voicemail/missing-vm/listen')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the recipient', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'other-user', listenedAt: null });
    const res = await request(app)
      .patch('/voicemail/vm-1/listen')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
  });

  it('returns 409 when already listened', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'recipient-user', listenedAt: NOW });
    const res = await request(app)
      .patch('/voicemail/vm-1/listen')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('listenedAt');
  });

  it('returns 200 and sets listenedAt on success', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'recipient-user', listenedAt: null });
    db().update.mockResolvedValue({ id: 'vm-1', listenedAt: NOW });
    const res = await request(app)
      .patch('/voicemail/vm-1/listen')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'vm-1');
    expect(res.body).toHaveProperty('listenedAt');
  });

  it('calls update with listenedAt as a Date', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'recipient-user', listenedAt: null });
    db().update.mockResolvedValue({ id: 'vm-1', listenedAt: new Date() });
    await request(app)
      .patch('/voicemail/vm-1/listen')
      .set('Authorization', `Bearer ${token()}`);
    const updateCall = db().update.mock.calls[0][0];
    expect(updateCall.data.listenedAt).toBeInstanceOf(Date);
  });
});

// ── DELETE /voicemail/:id ──────────────────────────────────────────────────────
describe('DELETE /voicemail/:id', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).delete('/voicemail/vm-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when voicemail does not exist', async () => {
    db().findUnique.mockResolvedValue(null);
    const res = await request(app)
      .delete('/voicemail/missing-vm')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the recipient', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'other-user' });
    const res = await request(app)
      .delete('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
  });

  it('returns 204 on successful deletion', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'recipient-user' });
    db().delete.mockResolvedValue({ id: 'vm-1' });
    const res = await request(app)
      .delete('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(204);
  });

  it('calls prisma.voicemail.delete with correct id', async () => {
    db().findUnique.mockResolvedValue({ id: 'vm-1', recipientId: 'recipient-user' });
    db().delete.mockResolvedValue({ id: 'vm-1' });
    await request(app)
      .delete('/voicemail/vm-1')
      .set('Authorization', `Bearer ${token()}`);
    const deleteCall = db().delete.mock.calls[0][0];
    expect(deleteCall.where).toEqual({ id: 'vm-1' });
  });
});
