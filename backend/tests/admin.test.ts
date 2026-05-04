// tests/admin.test.ts
// Unit/integration tests for admin-only management routes.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRouter from '../src/routes/admin';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'admin-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

jest.mock('@prisma/client', () => {
  const users = new Map<string, Record<string, unknown>>();
  const calls: Array<Record<string, unknown>> = [
    {
      id: 'c1',
      callerId: 'admin-user',
      calleeId: 'normal-user',
      startedAt: new Date(Date.now() - 3600000),
      endedAt: new Date(Date.now() - 3500000),
      durationMs: 60000,
    },
    {
      id: 'c2',
      callerId: 'normal-user',
      calleeId: 'admin-user',
      startedAt: new Date(Date.now() - 1800000),
      endedAt: new Date(Date.now() - 1700000),
      durationMs: 120000,
    },
  ];
  const messages: Array<Record<string, unknown>> = [{ id: 'm1' }];
  const incidents = new Map<string, Record<string, unknown>>();

  users.set('admin-user', {
    id: 'admin-user',
    name: 'Admin',
    email: 'jerryphisael@gmail.com',
    phoneNumber: '+254700000010',
    isAdmin: true,
    isActive: true,
    subscriptionExpiry: new Date(Date.now() + 86400000),
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
  });

  users.set('normal-user', {
    id: 'normal-user',
    name: 'Normal',
    email: 'normal@example.com',
    phoneNumber: '+254700000011',
    isAdmin: false,
    isActive: false,
    subscriptionExpiry: new Date('2026-03-01T00:00:00.000Z'),
    createdAt: new Date('2026-03-19T00:00:00.000Z'),
  });

  incidents.set('incident-open-1', {
    id: 'incident-open-1',
    type: 'CALL_FLAG',
    level: 'warning',
    code: 'CALL_FLAGGED',
    title: 'Flagged live call',
    message: 'Suspicious behavior',
    status: 'OPEN',
    source: 'ADMIN',
    callId: 'call_1',
    createdBy: 'admin-user',
    resolvedBy: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date('2026-03-21T08:00:00.000Z'),
    updatedAt: new Date('2026-03-21T08:00:00.000Z'),
  });

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => {
          if (!where.id) return null;
          return users.get(where.id) ?? null;
        }),
        count: jest.fn(async ({ where }: { where?: { isAdmin?: boolean; isActive?: boolean } } = {}) => {
          const all = [...users.values()];
          if (!where) return all.length;
          return all.filter((u) => {
            if (typeof where.isAdmin === 'boolean' && u.isAdmin !== where.isAdmin) return false;
            if (typeof where.isActive === 'boolean' && u.isActive !== where.isActive) return false;
            return true;
          }).length;
        }),
        findMany: jest.fn(async () => [...users.values()]),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = users.get(where.id);
          if (!existing) throw new Error('Not found');
          const updated = { ...existing, ...data };
          users.set(where.id, updated);
          return updated;
        }),
      },
      callLog: {
        count: jest.fn(async () => calls.length),
        findMany: jest.fn(async ({ where, select }: {
          where?: { startedAt?: { gte?: Date } };
          select?: { callerId?: boolean; calleeId?: boolean };
        } = {}) => {
          const filtered = where?.startedAt?.gte
            ? calls.filter((call) => (call.startedAt as Date) >= where.startedAt!.gte!)
            : calls;
          if (select?.callerId || select?.calleeId) {
            return filtered.map((call) => ({
              callerId: call.callerId,
              calleeId: call.calleeId,
            }));
          }
          return filtered;
        }),
        aggregate: jest.fn(async () => {
          const durations = calls.map((c) => c.durationMs as number).filter(Boolean);
          const avg = durations.length > 0
            ? durations.reduce((sum, v) => sum + v, 0) / durations.length
            : null;
          return { _avg: { durationMs: avg } };
        }),
      },
      message: {
        count: jest.fn(async () => messages.length),
      },
      incident: {
        count: jest.fn(async ({ where }: { where?: { status?: string } } = {}) => {
          const rows = [...incidents.values()];
          if (!where?.status) return rows.length;
          return rows.filter((row) => row.status === where.status).length;
        }),
        findMany: jest.fn(async ({ where, orderBy, take }: {
          where?: { status?: string; type?: string; callId?: { in?: string[] } };
          orderBy?: { createdAt?: 'asc' | 'desc' };
          take?: number;
        } = {}) => {
          let rows = [...incidents.values()];
          if (where?.status) rows = rows.filter((row) => row.status === where.status);
          if (where?.type) rows = rows.filter((row) => row.type === where.type);
          if (where?.callId?.in) rows = rows.filter((row) => where.callId?.in?.includes(String(row.callId ?? '')));

          if (orderBy?.createdAt === 'desc') {
            rows.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
          }
          if (orderBy?.createdAt === 'asc') {
            rows.sort((a, b) => new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime());
          }

          return typeof take === 'number' ? rows.slice(0, take) : rows;
        }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = `incident-${incidents.size + 1}`;
          const now = new Date();
          const row = {
            id,
            status: 'OPEN',
            source: 'ADMIN',
            resolvedBy: null,
            resolutionNote: null,
            resolvedAt: null,
            createdAt: now,
            updatedAt: now,
            ...data,
          };
          incidents.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = incidents.get(where.id);
          if (!existing) throw new Error('Not found');
          const updated = { ...existing, ...data, updatedAt: new Date() };
          incidents.set(where.id, updated);
          return updated;
        }),
      },
    })),
  };
});

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('admin routes', () => {
  const app = makeApp();

  it('rejects non-admin access', async () => {
    const res = await request(app)
      .get('/admin/overview')
      .set('Authorization', `Bearer ${token('normal-user')}`);

    expect(res.status).toBe(403);
  });

  it('returns overview for admin', async () => {
    const res = await request(app)
      .get('/admin/overview')
      .set('Authorization', `Bearer ${token('admin-user')}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      usersTotal: 2,
      adminsTotal: 1,
      activeUsers: 1,
      callsTotal: 2,
      messagesTotal: 1,
    });
  });

  it('lists users for admin', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${token('admin-user')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('updates user role', async () => {
    const res = await request(app)
      .patch('/admin/users/normal-user/role')
      .set('Authorization', `Bearer ${token('admin-user')}`)
      .send({ isAdmin: true });

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it('updates user subscription state', async () => {
    const res = await request(app)
      .patch('/admin/users/normal-user/subscription')
      .set('Authorization', `Bearer ${token('admin-user')}`)
      .send({ isActive: true, subscriptionExpiry: '2026-12-31T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });

  it('creates incident records', async () => {
    const res = await request(app)
      .post('/admin/incidents')
      .set('Authorization', `Bearer ${token('admin-user')}`)
      .send({
        type: 'MANUAL',
        level: 'critical',
        code: 'NETWORK_DOWN',
        title: 'Backbone outage',
        message: 'Packet loss spike in Nairobi POP',
        source: 'ADMIN',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      code: 'NETWORK_DOWN',
      title: 'Backbone outage',
    });
  });

  it('lists open incidents', async () => {
    const res = await request(app)
      .get('/admin/incidents?status=OPEN&limit=50')
      .set('Authorization', `Bearer ${token('admin-user')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    expect(res.body.incidents.length).toBeGreaterThan(0);
    expect(res.body.incidents[0].status).toBe('OPEN');
  });

  it('resolves an incident', async () => {
    const created = await request(app)
      .post('/admin/incidents')
      .set('Authorization', `Bearer ${token('admin-user')}`)
      .send({
        type: 'MANUAL',
        level: 'warning',
        code: 'CAPACITY_WARNING',
        title: 'High CPU',
        message: 'Node CPU exceeded 85%',
      });

    const incidentId = created.body.id;
    const res = await request(app)
      .patch(`/admin/incidents/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${token('admin-user')}`)
      .send({ resolutionNote: 'Autoscaling resolved pressure' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: incidentId,
      status: 'RESOLVED',
      resolutionNote: 'Autoscaling resolved pressure',
      resolvedBy: 'admin-user',
    });
    expect(res.body.resolvedAt).toBeTruthy();
  });
});
