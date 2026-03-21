// tests/call-analytics.test.ts
// Unit tests for GET /calls/analytics/summary.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import callsRouter from '../src/routes/calls';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'user-1'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

jest.mock('@prisma/client', () => {
  const callAnalytics = {
    findMany: jest.fn(),
  };

  const callLog = {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
    updateMany: jest.fn(),
  };

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      callAnalytics,
      callLog,
    })),
    __callAnalytics: callAnalytics,
  };
});

function analyticsDb(): { findMany: jest.Mock } {
  return (jest.requireMock('@prisma/client') as { __callAnalytics: { findMany: jest.Mock } }).__callAnalytics;
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/calls', callsRouter);
  return app;
}

describe('GET /calls/analytics/summary', () => {
  let app: Express;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/calls/analytics/summary');
    expect(res.status).toBe(401);
  });

  it('returns defaults for empty analytics window', async () => {
    analyticsDb().findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/calls/analytics/summary')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      windowDays: 30,
      totalCalls: 0,
      successRate: 100,
      avgLatencyMs: 0,
      avgPacketLossPct: 0,
      relayRatePct: 0,
      totalDurationMinutes: 0,
      totalDataMb: 0,
      totalReconnections: 0,
      totalIceRestarts: 0,
      byNetworkType: {},
    });
  });

  it('aggregates analytics metrics correctly', async () => {
    analyticsDb().findMany.mockResolvedValue([
      {
        success: true,
        durationMs: 60000,
        dataBytes: 1024 * 1024,
        avgLatencyMs: 80,
        packetLossPct: 1,
        relayUsed: false,
        reconnectionEvents: 1,
        iceRestartCount: 1,
        networkType: 'wifi',
      },
      {
        success: false,
        durationMs: 120000,
        dataBytes: 2 * 1024 * 1024,
        avgLatencyMs: 220,
        packetLossPct: 5,
        relayUsed: true,
        reconnectionEvents: 2,
        iceRestartCount: 3,
        networkType: 'cellular',
      },
    ]);

    const res = await request(app)
      .get('/calls/analytics/summary?days=14')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      windowDays: 14,
      totalCalls: 2,
      successRate: 50,
      avgLatencyMs: 150,
      avgPacketLossPct: 3,
      relayRatePct: 50,
      totalDurationMinutes: 3,
      totalDataMb: 3,
      totalReconnections: 3,
      totalIceRestarts: 4,
      byNetworkType: {
        wifi: 1,
        cellular: 1,
      },
    });
  });

  it('clamps days query to max window', async () => {
    analyticsDb().findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/calls/analytics/summary?days=9999')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(90);
  });
});
