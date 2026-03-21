// tests/contacts.test.ts
// Unit tests for GET /contacts/search.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import contactsRouter from '../src/routes/contacts';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'searcher-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Prisma mock ────────────────────────────────────────────────────────────────
// jest.mock is hoisted, so we can't reference outer variables inside the factory.
// Expose the mock function via a module-level getter instead.

jest.mock('@prisma/client', () => {
  const userFindMany = jest.fn();
  const tellyIDFindMany = jest.fn();
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      user: { findMany: userFindMany },
      tellyID: { findMany: tellyIDFindMany },
    })),
    __userFindMany: userFindMany,
    __tellyIDFindMany: tellyIDFindMany,
  };
});

function getMockUserFindMany(): jest.Mock {
  return (jest.requireMock('@prisma/client') as { __userFindMany: jest.Mock }).__userFindMany;
}

function getMockTellyIDFindMany(): jest.Mock {
  return (jest.requireMock('@prisma/client') as { __tellyIDFindMany: jest.Mock }).__tellyIDFindMany;
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/contacts', contactsRouter);
  return app;
}

const SAMPLE_USERS = [
  { id: 'user-a', name: 'Alice Kamau', phoneNumber: '+254711000001' },
  { id: 'user-b', name: 'Bob Otieno', phoneNumber: '+254722000002' },
];

describe('GET /contacts/search', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    getMockTellyIDFindMany().mockResolvedValue([]);
    getMockUserFindMany().mockResolvedValue(SAMPLE_USERS);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/contacts/search?q=Alice');
    expect(res.status).toBe(401);
  });

  it('returns 400 for a query shorter than 2 characters', async () => {
    const res = await request(app)
      .get('/contacts/search?q=A')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2 char/i);
  });

  it('returns 400 when query is empty', async () => {
    const res = await request(app)
      .get('/contacts/search')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('returns matching contacts', async () => {
    const res = await request(app)
      .get('/contacts/search?q=Alice')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('contacts');
    expect(Array.isArray(res.body.contacts)).toBe(true);
    expect(res.body.contacts).toHaveLength(2);
  });

  it('excludes password hash from results', async () => {
    getMockUserFindMany().mockResolvedValue([{ id: 'user-a', name: 'Alice', phoneNumber: '+254711000001', tellyId: null }]);
    const res = await request(app)
      .get('/contacts/search?q=Alice')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.body.contacts[0]).not.toHaveProperty('passwordHash');
  });

  it('passes the current userId as an exclusion filter', async () => {
    await request(app)
      .get('/contacts/search?q=bo')
      .set('Authorization', `Bearer ${token('me-user')}`);
    const callArg = getMockUserFindMany().mock.calls[0][0];
    expect(callArg.where.AND[0]).toMatchObject({ id: { not: 'me-user' } });
  });
});
