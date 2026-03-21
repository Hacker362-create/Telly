// src/routes/admin.ts
// Admin-only platform control routes.

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, AuthRequest, apiLimiter } from '../middleware/auth';
import { activeCalls, terminateActiveCall } from '../signaling/server';
import { getPresenceBatch } from '../presence/PresenceStore';
import { getRedisClient } from '../signaling/Gatekeeper';
import { metricsRegistry } from '../metrics/registry';

const router = Router();
const prisma = new PrismaClient();

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDaysWindow(days: number): string[] {
  const now = new Date();
  const arr: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    arr.push(toIsoDay(d));
  }
  return arr;
}

async function readReliability(callId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await getRedisClient().get(`call:reliability:${callId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readMetricsValue(name: string): Promise<number> {
  try {
    const json = await metricsRegistry.getMetricsAsJSON();
    const metric = json.find((m) => m.name === name);
    if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return 0;
    const first = metric.values[0];
    const v = typeof first.value === 'number' ? first.value : Number(first.value ?? 0);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

router.get('/overview', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    user: { count: (args?: unknown) => Promise<number> };
    callLog: { count: (args?: unknown) => Promise<number> };
    message: { count: (args?: unknown) => Promise<number> };
    transaction?: { count: (args?: unknown) => Promise<number> };
    callAnalytics?: {
      count: (args?: unknown) => Promise<number>;
      aggregate: (args?: unknown) => Promise<Record<string, unknown>>;
    };
    incident?: { count: (args?: unknown) => Promise<number> };
  };

  const [
    usersTotal,
    adminsTotal,
    activeUsers,
    callsTotal,
    messagesTotal,
    paidTransactions,
    successfulCalls,
    qualityAggregate,
    liveCalls,
    openIncidents,
  ] = await Promise.all([
    p.user.count(),
    p.user.count({ where: { isAdmin: true } }),
    p.user.count({ where: { isActive: true } }),
    p.callLog.count(),
    p.message.count(),
    p.transaction?.count?.({ where: { status: 'SUCCESS' } }) ?? Promise.resolve(0),
    p.callAnalytics?.count?.({ where: { success: true } }) ?? Promise.resolve(0),
    p.callAnalytics?.aggregate?.({
      _avg: { avgLatencyMs: true, packetLossPct: true },
      _sum: { dataBytes: true },
    }) ?? Promise.resolve({ _avg: { avgLatencyMs: 0, packetLossPct: 0 }, _sum: { dataBytes: 0 } }),
    Promise.resolve(activeCalls.size),
    p.incident?.count?.({ where: { status: 'OPEN' } }) ?? Promise.resolve(0),
  ]);

  const callSuccessRate = callsTotal > 0
    ? Number(((successfulCalls / callsTotal) * 100).toFixed(1))
    : 0;

  const avgLatencyMs = Number((qualityAggregate as { _avg?: { avgLatencyMs?: number } })
    ?._avg?.avgLatencyMs ?? 0);
  const avgPacketLossPct = Number((qualityAggregate as { _avg?: { packetLossPct?: number } })
    ?._avg?.packetLossPct ?? 0);
  const totalDataBytes = Number((qualityAggregate as { _sum?: { dataBytes?: number } })
    ?._sum?.dataBytes ?? 0);

  const activeCallsMetric = await readMetricsValue('telly_active_calls');

  res.json({
    usersTotal,
    adminsTotal,
    activeUsers,
    callsTotal,
    messagesTotal,
    paidTransactions,
    callSuccessRate,
    avgLatencyMs: Number(avgLatencyMs.toFixed(1)),
    avgPacketLossPct: Number(avgPacketLossPct.toFixed(2)),
    totalDataMB: Number((totalDataBytes / (1024 * 1024)).toFixed(2)),
    liveCalls,
    activeCallsMetric,
    openIncidents,
  });
});

router.get('/live-calls', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const callIds = Array.from(activeCalls.keys());
  const incidents = callIds.length === 0
    ? []
    : await (prisma as unknown as {
      incident?: { findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>> }
    }).incident?.findMany?.({
      where: {
        callId: { in: callIds },
        type: 'CALL_FLAG',
        status: 'OPEN',
      },
      select: {
        id: true,
        callId: true,
        message: true,
        createdAt: true,
        createdBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }) ?? [];

  const flaggedByCallId = new Map<string, Record<string, unknown>>();
  incidents.forEach((incident) => {
    const callId = String(incident.callId ?? '');
    if (!callId || flaggedByCallId.has(callId)) return;
    flaggedByCallId.set(callId, incident);
  });

  const calls = await Promise.all(
    Array.from(activeCalls.values()).map(async (call) => {
      const reliability = await readReliability(call.callId);
      const durationMs = Date.now() - call.startedAt.getTime();
      return {
        callId: call.callId,
        callerId: call.callerId,
        calleeId: call.calleeId,
        roomId: call.roomId,
        startedAt: call.startedAt,
        acceptedAt: call.acceptedAt ?? null,
        relayMode: Boolean(call.relayMode),
        durationMs,
        reliability,
        flagged: flaggedByCallId.get(call.callId) ?? null,
      };
    }),
  );

  res.json({
    total: calls.length,
    calls,
  });
});

router.post('/live-calls/:callId/end', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { callId } = req.params;
  const terminated = terminateActiveCall(callId, 'terminated-by-admin');
  if (!terminated) {
    res.status(404).json({ error: 'Active call not found' });
    return;
  }

  res.json({ ok: true, callId });
});

router.post('/live-calls/:callId/flag', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { callId } = req.params;
  const reason = String((req.body as { reason?: string }).reason ?? '').trim();
  if (!reason) {
    res.status(400).json({ error: 'reason is required' });
    return;
  }

  const incident = await (prisma as unknown as {
    incident?: { create: (args?: unknown) => Promise<Record<string, unknown>> }
  }).incident?.create?.({
    data: {
      type: 'CALL_FLAG',
      level: 'warning',
      code: 'CALL_FLAGGED',
      title: 'Flagged live call',
      message: reason,
      status: 'OPEN',
      source: 'ADMIN',
      callId,
      createdBy: req.userId ?? null,
      metadata: JSON.stringify({ callId, reason }),
    },
  });

  res.json(incident ?? {
    callId,
    message: reason,
    createdBy: req.userId ?? 'unknown',
  });
});

router.get('/incidents', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const status = String(req.query.status ?? 'OPEN').toUpperCase();
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));

  const incidents = await (prisma as unknown as {
    incident?: { findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>> }
  }).incident?.findMany?.({
    where: status === 'ALL' ? undefined : { status },
    orderBy: { createdAt: 'desc' },
    take: limit,
  }) ?? [];

  res.json({ incidents });
});

router.post('/incidents', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    type = 'MANUAL',
    level = 'warning',
    code = 'MANUAL_INCIDENT',
    title,
    message,
    source = 'ADMIN',
    callId,
  } = req.body as {
    type?: string;
    level?: string;
    code?: string;
    title?: string;
    message?: string;
    source?: string;
    callId?: string;
  };

  if (!title || !message) {
    res.status(400).json({ error: 'title and message are required' });
    return;
  }

  const incident = await (prisma as unknown as {
    incident?: { create: (args?: unknown) => Promise<Record<string, unknown>> }
  }).incident?.create?.({
    data: {
      type,
      level,
      code,
      title,
      message,
      status: 'OPEN',
      source,
      callId: callId || null,
      createdBy: req.userId ?? null,
    },
  });

  res.status(201).json(incident ?? { ok: true });
});

router.patch('/incidents/:id/resolve', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { resolutionNote } = req.body as { resolutionNote?: string };
  const incident = await (prisma as unknown as {
    incident?: { update: (args?: unknown) => Promise<Record<string, unknown>> }
  }).incident?.update?.({
    where: { id: req.params.id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedBy: req.userId ?? null,
      resolutionNote: resolutionNote?.trim() || null,
    },
  }).catch(() => null);

  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  res.json(incident);
});

router.get('/performance', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    callAnalytics?: {
      findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
      aggregate: (args?: unknown) => Promise<Record<string, unknown>>;
      count: (args?: unknown) => Promise<number>;
    }
  };

  const dayLabels = getDaysWindow(7);
  const start = new Date(`${dayLabels[0]}T00:00:00.000Z`);

  const analytics = p.callAnalytics
    ? await p.callAnalytics.findMany({
      where: { endedAt: { gte: start } },
      select: {
        endedAt: true,
        success: true,
        avgLatencyMs: true,
        packetLossPct: true,
        dataBytes: true,
      },
      orderBy: { endedAt: 'asc' },
    })
    : [];

  const byDay: Record<string, {
    calls: number;
    success: number;
    latencySum: number;
    packetLossSum: number;
    dataBytes: number;
  }> = {};
  dayLabels.forEach((d) => {
    byDay[d] = { calls: 0, success: 0, latencySum: 0, packetLossSum: 0, dataBytes: 0 };
  });

  analytics.forEach((row) => {
    const day = toIsoDay(new Date(String(row.endedAt)));
    if (!byDay[day]) return;
    byDay[day].calls += 1;
    byDay[day].success += row.success ? 1 : 0;
    byDay[day].latencySum += Number(row.avgLatencyMs ?? 0);
    byDay[day].packetLossSum += Number(row.packetLossPct ?? 0);
    byDay[day].dataBytes += Number(row.dataBytes ?? 0);
  });

  const trend = dayLabels.map((day) => {
    const d = byDay[day];
    const calls = d.calls;
    return {
      day,
      calls,
      successRate: calls > 0 ? Number(((d.success / calls) * 100).toFixed(1)) : 0,
      avgLatencyMs: calls > 0 ? Number((d.latencySum / calls).toFixed(1)) : 0,
      packetLossPct: calls > 0 ? Number((d.packetLossSum / calls).toFixed(2)) : 0,
      dataMB: Number((d.dataBytes / (1024 * 1024)).toFixed(2)),
    };
  });

  const [totalCalls, successfulCalls, aggregate] = p.callAnalytics
    ? await Promise.all([
      p.callAnalytics.count(),
      p.callAnalytics.count({ where: { success: true } }),
      p.callAnalytics.aggregate({ _avg: { avgLatencyMs: true, packetLossPct: true } }),
    ])
    : [0, 0, { _avg: { avgLatencyMs: 0, packetLossPct: 0 } }];

  res.json({
    kpis: {
      totalCalls,
      successfulCalls,
      successRate: totalCalls > 0 ? Number(((successfulCalls / totalCalls) * 100).toFixed(1)) : 0,
      avgLatencyMs: Number((aggregate as { _avg?: { avgLatencyMs?: number } })._avg?.avgLatencyMs ?? 0),
      avgPacketLossPct: Number((aggregate as { _avg?: { packetLossPct?: number } })._avg?.packetLossPct ?? 0),
    },
    trend,
  });
});

router.get('/payments', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    transaction?: {
      aggregate: (args?: unknown) => Promise<Record<string, unknown>>;
      count: (args?: unknown) => Promise<number>;
      findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
    }
  };

  if (!p.transaction) {
    res.json({ summary: { totalRevenue: 0, successCount: 0, failedCount: 0, pendingCount: 0 }, recent: [] });
    return;
  }

  const [sum, successCount, failedCount, pendingCount, recent] = await Promise.all([
    p.transaction.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS' } }),
    p.transaction.count({ where: { status: 'SUCCESS' } }),
    p.transaction.count({ where: { status: 'FAILED' } }),
    p.transaction.count({ where: { status: 'PENDING' } }),
    p.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        userId: true,
        amount: true,
        status: true,
        mpesaReceiptNumber: true,
        checkoutRequestId: true,
        createdAt: true,
      },
    }),
  ]);

  const totalRevenue = Number((sum as { _sum?: { amount?: number } })._sum?.amount ?? 0);

  res.json({
    summary: {
      totalRevenue,
      successCount,
      failedCount,
      pendingCount,
    },
    recent,
  });
});

router.get('/infrastructure', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const redisOk = await getRedisClient().get('infra:probe').then(() => true).catch(() => false);

  const mem = process.memoryUsage();
  const cpuLoad = process.cpuUsage();

  res.json({
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    memoryMB: {
      rss: Number((mem.rss / (1024 * 1024)).toFixed(1)),
      heapUsed: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
      heapTotal: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
    },
    cpuMicros: {
      user: cpuLoad.user,
      system: cpuLoad.system,
    },
    redisReachable: redisOk,
    activeCalls: activeCalls.size,
    workers: {
      pid: process.pid,
      env: process.env.NODE_ENV ?? 'development',
    },
  });
});

router.get('/alerts', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    callAnalytics?: {
      aggregate: (args?: unknown) => Promise<Record<string, unknown>>;
      count: (args?: unknown) => Promise<number>;
    };
    incident?: {
      findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
      count: (args?: unknown) => Promise<number>;
    };
  };

  const [avg, total, success] = p.callAnalytics
    ? await Promise.all([
      p.callAnalytics.aggregate({ _avg: { avgLatencyMs: true, packetLossPct: true } }),
      p.callAnalytics.count(),
      p.callAnalytics.count({ where: { success: true } }),
    ])
    : [{ _avg: { avgLatencyMs: 0, packetLossPct: 0 } }, 0, 0];

  const avgLatency = Number((avg as { _avg?: { avgLatencyMs?: number } })._avg?.avgLatencyMs ?? 0);
  const avgPacketLoss = Number((avg as { _avg?: { packetLossPct?: number } })._avg?.packetLossPct ?? 0);
  const successRate = total > 0 ? (success / total) * 100 : 100;

  const alerts: Array<{ level: 'info' | 'warning' | 'critical'; message: string; code: string }> = [];
  if (avgLatency > 250) alerts.push({ level: 'warning', code: 'LATENCY_HIGH', message: `Average latency is high (${avgLatency.toFixed(1)} ms)` });
  if (avgPacketLoss > 5) alerts.push({ level: 'critical', code: 'PACKET_LOSS_HIGH', message: `Packet loss above threshold (${avgPacketLoss.toFixed(2)}%)` });
  if (successRate < 90) alerts.push({ level: 'critical', code: 'SUCCESS_RATE_LOW', message: `Call success rate dropped to ${successRate.toFixed(1)}%` });
  if (activeCalls.size > 200) alerts.push({ level: 'warning', code: 'LOAD_SPIKE', message: `Live call load is elevated (${activeCalls.size})` });
  if (alerts.length === 0) {
    alerts.push({ level: 'info', code: 'ALL_HEALTHY', message: 'All monitored thresholds are healthy' });
  }

  const [openIncidents, openCount] = p.incident
    ? await Promise.all([
      p.incident.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 25 }),
      p.incident.count({ where: { status: 'OPEN' } }),
    ])
    : [[], 0];

  res.json({
    generatedAt: new Date().toISOString(),
    alerts,
    openIncidents,
    openCount,
  });
});

router.get('/data-savings', apiLimiter, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    callAnalytics?: {
      count: (args?: unknown) => Promise<number>;
      aggregate: (args?: unknown) => Promise<Record<string, unknown>>;
    }
  };

  if (!p.callAnalytics) {
    res.json({ callsAnalyzed: 0, estimatedSavedMB: 0, relayUsagePct: 0, avgDataPerCallMB: 0 });
    return;
  }

  const [callsAnalyzed, relayCalls, sumData] = await Promise.all([
    p.callAnalytics.count(),
    p.callAnalytics.count({ where: { relayUsed: true } }),
    p.callAnalytics.aggregate({ _sum: { dataBytes: true } }),
  ]);

  const totalBytes = Number((sumData as { _sum?: { dataBytes?: number } })._sum?.dataBytes ?? 0);
  const avgDataPerCallMB = callsAnalyzed > 0
    ? Number(((totalBytes / callsAnalyzed) / (1024 * 1024)).toFixed(2))
    : 0;

  // Baseline estimate: legacy stack average 1.2 MB/call; show estimated savings.
  const legacyPerCallBytes = 1.2 * 1024 * 1024;
  const baselineBytes = callsAnalyzed * legacyPerCallBytes;
  const estimatedSavedMB = Number(Math.max(0, (baselineBytes - totalBytes) / (1024 * 1024)).toFixed(2));
  const relayUsagePct = callsAnalyzed > 0 ? Number(((relayCalls / callsAnalyzed) * 100).toFixed(1)) : 0;

  res.json({
    callsAnalyzed,
    estimatedSavedMB,
    relayUsagePct,
    avgDataPerCallMB,
  });
});

router.get('/users', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = prisma as unknown as {
    user: {
      count: (args?: unknown) => Promise<number>;
      findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    callLog?: {
      groupBy: (args?: unknown) => Promise<Array<{ callerId: string; _count: { _all: number } }>>;
    };
  };
  const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query.limit as string ?? String(DEFAULT_PAGE_SIZE), 10)),
  );
  const q = (req.query.q as string | undefined)?.trim();

  const where = q
    ? {
        OR: [
          { email: { contains: q } },
          { name: { contains: q } },
          { phoneNumber: { contains: q } },
        ],
      }
    : undefined;

  const [total, users, callTotals] = await Promise.all([
    p.user.count({ where }),
    p.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        isAdmin: true,
        isActive: true,
        subscriptionExpiry: true,
        createdAt: true,
      },
    }),
    p.callLog?.groupBy?.({
      by: ['callerId'],
      _count: { _all: true },
    }) ?? Promise.resolve([]),
  ]);

  const userIds = users.map((u) => String(u.id));
  const presence = await getPresenceBatch(userIds).catch(
    () => ({} as Record<string, { status: string; updatedAt: string }>),
  );
  const callsMap = new Map(callTotals.map((row) => [row.callerId, row._count._all]));

  const enrichedUsers = users.map((u) => {
    const id = String(u.id);
    const pRec = presence[id] ?? { status: 'offline', updatedAt: new Date().toISOString() };
    return {
      ...u,
      presenceStatus: pRec.status,
      lastActiveAt: pRec.updatedAt,
      totalCallsMade: callsMap.get(id) ?? 0,
    };
  });

  res.json({
    users: enrichedUsers,
    pagination: {
      page,
      limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

router.patch('/users/:id/role', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { isAdmin } = req.body as { isAdmin?: boolean };
  if (typeof isAdmin !== 'boolean') {
    res.status(400).json({ error: 'isAdmin boolean is required' });
    return;
  }

  const user = await (prisma as unknown as {
    user: { update: (args: unknown) => Promise<Record<string, unknown>> }
  }).user.update({
    where: { id: req.params.id },
    data: { isAdmin },
    select: { id: true, email: true, name: true, isAdmin: true },
  }).catch(() => null);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

router.patch('/users/:id/ban', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { banned } = req.body as { banned?: boolean };
  if (typeof banned !== 'boolean') {
    res.status(400).json({ error: 'banned boolean is required' });
    return;
  }

  const now = new Date();
  const user = await (prisma as unknown as {
    user: { update: (args: unknown) => Promise<Record<string, unknown>> }
  }).user.update({
    where: { id: req.params.id },
    data: {
      isActive: !banned,
      subscriptionExpiry: banned ? now : undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      subscriptionExpiry: true,
    },
  }).catch(() => null);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    ...user,
    banned,
  });
});

router.patch('/users/:id/subscription', apiLimiter, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { isActive, subscriptionExpiry } = req.body as {
    isActive?: boolean;
    subscriptionExpiry?: string;
  };

  if (typeof isActive !== 'boolean' && typeof subscriptionExpiry === 'undefined') {
    res.status(400).json({ error: 'Provide isActive and/or subscriptionExpiry' });
    return;
  }

  let expiryDate: Date | undefined;
  if (typeof subscriptionExpiry !== 'undefined') {
    expiryDate = new Date(subscriptionExpiry);
    if (Number.isNaN(expiryDate.getTime())) {
      res.status(400).json({ error: 'subscriptionExpiry must be an ISO date string' });
      return;
    }
  }

  const data: { isActive?: boolean; subscriptionExpiry?: Date } = {};
  if (typeof isActive === 'boolean') data.isActive = isActive;
  if (expiryDate) data.subscriptionExpiry = expiryDate;

  const user = await (prisma as unknown as {
    user: { update: (args: unknown) => Promise<Record<string, unknown>> }
  }).user.update({
    where: { id: req.params.id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      subscriptionExpiry: true,
    },
  }).catch(() => null);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

export default router;
