// tests/auth.test.ts
// Unit/integration tests for /auth/* and /calls/* routes.
// Uses a mocked Prisma client and bcryptjs so no real DB is required.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import authRouter from '../src/routes/auth';
import callsRouter from '../src/routes/calls';

// ── Prisma mock ────────────────────────────────────────────────────────────────
jest.mock('@prisma/client', () => {
  const users = new Map<string, Record<string, unknown>>();
  const callLogs: Record<string, unknown>[] = [];

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return users.get(where.id) ?? null;
          if (where.email) {
            return [...users.values()].find((u) => u.email === where.email) ?? null;
          }
          return null;
        }),
        create: jest.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const id = (data.id as string | undefined) ?? `user-${Date.now()}`;
          const record: Record<string, unknown> = { ...data, id, createdAt: new Date() };
          users.set(id, record);
          if (!select) return record;
          return Object.fromEntries(
            Object.keys(select).filter((k) => select[k]).map((k) => [k, record[k]]),
          );
        }),
      },
      callLog: {
        count: jest.fn(async () => callLogs.length),
        findMany: jest.fn(async () => callLogs.slice(0, 20)),
      },
    })),
  };
});

const JWT_SECRET = 'telly-secret-change-in-production';

function makeToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/calls', callsRouter);
  return app;
}

// ── Registration tests ─────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  const app = makeApp();

  const valid = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    phoneNumber: '+254712345678',
  };

  it('rejects missing fields', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'x@x.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects invalid email', async () => {
    const res = await request(app).post('/auth/register').send({ ...valid, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects phone not in E.164 format', async () => {
    const res = await request(app).post('/auth/register').send({ ...valid, phoneNumber: '0712345678' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/E\.164/i);
  });

  it('rejects short password', async () => {
    const res = await request(app).post('/auth/register').send({ ...valid, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 char/i);
  });

  it('creates a user and returns token', async () => {
    const res = await request(app).post('/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: valid.email, name: valid.name });
  });

  it('rejects duplicate email', async () => {
    // First registration goes through (or is already stored from the test above)
    // Second should conflict
    const res = await request(app).post('/auth/register').send(valid);
    expect([409, 201]).toContain(res.status);
    if (res.status === 201) {
      const res2 = await request(app).post('/auth/register').send(valid);
      expect(res2.status).toBe(409);
    }
  });
});

// ── Login tests ────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  const app = makeApp();

  const credentials = { email: 'login-test@example.com', password: 'password123' };

  beforeAll(async () => {
    // Pre-populate a user so login can succeed
    const hash = await bcrypt.hash(credentials.password, 1);
    const { PrismaClient } = jest.requireMock('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.user.create({
      data: {
        id: 'login-user',
        name: 'Login User',
        email: credentials.email,
        passwordHash: hash,
        phoneNumber: '+254700000001',
        isActive: false,
        subscriptionExpiry: new Date(),
      },
    });
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'nobody@x.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app).post('/auth/login').send({ ...credentials, password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('returns token on valid credentials', async () => {
    const res = await request(app).post('/auth/login').send(credentials);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: credentials.email });
  });
});

// ── GET /auth/me tests ─────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  const app = makeApp();

  beforeAll(async () => {
    const { PrismaClient } = jest.requireMock('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.user.create({
      data: {
        id: 'me-user',
        name: 'Me User',
        email: 'me@example.com',
        passwordHash: 'hash',
        phoneNumber: '+254700000002',
        isActive: true,
        subscriptionExpiry: new Date(Date.now() + 86400000),
      },
    });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user profile with valid token', async () => {
    const token = makeToken('me-user');
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'me-user', email: 'me@example.com' });
  });

  it('returns 404 when userId in token has no user record', async () => {
    const token = makeToken('ghost-user');
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /calls/history tests ───────────────────────────────────────────────────

describe('GET /calls/history', () => {
  const app = makeApp();

  it('returns 401 without token', async () => {
    const res = await request(app).get('/calls/history');
    expect(res.status).toBe(401);
  });

  it('returns paginated call history with valid token', async () => {
    const token = makeToken('user-abc');
    const res = await request(app)
      .get('/calls/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('calls');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.calls)).toBe(true);
  });

  it('respects the role=caller query parameter', async () => {
    const token = makeToken('user-abc');
    const res = await request(app)
      .get('/calls/history?role=caller&page=1&limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
  });

  it('caps limit at 50', async () => {
    const token = makeToken('user-abc');
    const res = await request(app)
      .get('/calls/history?limit=999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(50);
  });
});
