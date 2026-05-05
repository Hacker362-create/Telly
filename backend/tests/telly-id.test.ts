// tests/telly-id.test.ts
// Integration tests for Telly ID routes

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'telly-secret-change-in-production';

function token(userId = 'user-1'): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

jest.mock('@prisma/client', () => {
  const users = new Map<string, Record<string, unknown>>();
  const tellyIds = new Map<string, Record<string, unknown>>();
  const contacts = new Map<string, Record<string, unknown>>();

  // Initialize test data
  users.set('user-1', {
    id: 'user-1',
    name: 'John Doe',
    email: 'john.doe@example.com',
    isActive: true,
    subscriptionExpiry: new Date(Date.now() + 86400000),
  });

  users.set('user-2', {
    id: 'user-2',
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    isActive: true,
    subscriptionExpiry: new Date(Date.now() + 86400000),
  });

  tellyIds.set('user-1', {
    userId: 'user-1',
    tellyId: 'johndoe-42',
    baseUsername: 'johndoe',
    numericSuffix: 42,
  });

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => {
          return users.get(String(where?.id)) ?? null;
        }),
      },
      tellyID: {
        findUnique: jest.fn(async ({ where }: { where: { userId?: string; tellyId?: string } }) => {
          if (where?.userId) {
            return [...tellyIds.values()].find((t) => t.userId === where.userId) ?? null;
          }
          if (where?.tellyId) {
            return [...tellyIds.values()].find((t) => t.tellyId === where.tellyId) ?? null;
          }
          return null;
        }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { ...data, id: `telly-${Math.random()}`, createdAt: new Date() };
          tellyIds.set(String(data.userId), record);
          return record;
        }),
      },
      contact: {
        findMany: jest.fn(async ({ where }: { where?: { ownerId?: string } } = {}) => {
          if (!where?.ownerId) return [];
          return [...contacts.values()].filter((c) => c.ownerId === where.ownerId);
        }),
        findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => {
          if (!where?.id) return null;
          return [...contacts.values()].find((c) => c.id === where.id) ?? null;
        }),
        findFirst: jest.fn(async ({ where }: { where?: { ownerId?: string; tellyId?: string } }) => {
          if (!where) return null;
          return (
            [...contacts.values()].find(
              (c) => c.ownerId === where.ownerId && c.tellyId === where.tellyId
            ) ?? null
          );
        }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { ...data, id: `contact-${Math.random()}`, createdAt: new Date() };
          contacts.set(String(data.ownerId) + '-' + String(data.contactUserId), record);
          return record;
        }),
        delete: jest.fn(async ({ where }: { where: { id: string } }) => {
          const entries = [...contacts.entries()];
          for (const [key, val] of entries) {
            if (val.id === where.id) {
              contacts.delete(key);
              return val;
            }
          }
          throw new Error('Not found');
        }),
      },
    })),
  };
});

import tellyIDRouter from '../src/routes/telly-id';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/', tellyIDRouter);
  return app;
}

describe('Telly ID management', () => {
  const app = makeApp();

  it('looks up telly ID without auth', async () => {
    const res = await request(app).get('/lookup/johndoe-42');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('John Doe');
    expect(res.body.isActive).toBe(true);
  });

  it('returns 404 for unknown telly ID', async () => {
    const res = await request(app).get('/lookup/unknown-99');

    expect(res.status).toBe(404);
  });

  it('prevents auth errors when missing token', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(401);
  });
});
