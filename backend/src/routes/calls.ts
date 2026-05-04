// src/routes/calls.ts
// REST endpoints for call history and call recordings.
// Allows authenticated users to retrieve a paginated list of their past calls
// and to attach a recording URL + transcript to a completed call.

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_ANALYTICS_DAYS = 90;
const DEFAULT_ANALYTICS_DAYS = 30;

type AnalyticsRow = {
  success: boolean;
  durationMs: number;
  dataBytes: number;
  avgLatencyMs: number;
  packetLossPct: number;
  relayUsed: boolean;
  reconnectionEvents: number;
  iceRestartCount: number;
  networkType: string;
};

/**
 * GET /calls/history
 * Returns a paginated list of calls where the user was caller or callee.
 *
 * Query params:
 *   page   – page number (1-based, default 1)
 *   limit  – results per page (default 20, max 50)
 *   role   – "caller" | "callee" | "all" (default "all")
 */
router.get('/history', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;

  const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query.limit as string ?? String(DEFAULT_PAGE_SIZE), 10)),
  );
  const role = (req.query.role as string) ?? 'all';

  const where =
    role === 'caller'
      ? { callerId: userId }
      : role === 'callee'
        ? { calleeId: userId }
        : { OR: [{ callerId: userId }, { calleeId: userId }] };

  const [total, calls] = await Promise.all([
    prisma.callLog.count({ where }),
    prisma.callLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          dataBytes: true,
          estimatedAirtimeCost: true,
          estimatedSavingsKes: true,
          caller: { select: { name: true, phoneNumber: true } },
          callee: { select: { name: true, phoneNumber: true } },
        },
      }),
  ]);

  res.json({
    calls,
    pagination: {
      page,
      limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

/**
 * GET /calls/analytics/summary
 * Returns reliability and network summary metrics for the authenticated user.
 *
 * Query params:
 *   days – lookback window (default 30, max 90)
 */
router.get('/analytics/summary', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const days = Math.min(
    MAX_ANALYTICS_DAYS,
    Math.max(1, parseInt(req.query.days as string ?? String(DEFAULT_ANALYTICS_DAYS), 10)),
  );

  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await (prisma as unknown as {
    callAnalytics: { findMany: (args: unknown) => Promise<AnalyticsRow[]> }
  }).callAnalytics.findMany({
    where: {
      OR: [{ callerId: userId }, { calleeId: userId }],
      endedAt: { gte: since },
    },
    orderBy: { endedAt: 'desc' },
    select: {
      success: true,
      durationMs: true,
      dataBytes: true,
      avgLatencyMs: true,
      packetLossPct: true,
      relayUsed: true,
      reconnectionEvents: true,
      iceRestartCount: true,
      networkType: true,
    },
  });

  const totalCalls = rows.length;
  const successes = rows.filter((r: AnalyticsRow) => r.success).length;
  const successRate = totalCalls > 0 ? (successes / totalCalls) * 100 : 100;

  const totals = rows.reduce(
    (acc: { durationMs: number; dataBytes: number; latency: number; loss: number; reconnections: number; iceRestarts: number; relayCalls: number }, r: AnalyticsRow) => {
      acc.durationMs += r.durationMs;
      acc.dataBytes += r.dataBytes;
      acc.latency += r.avgLatencyMs;
      acc.loss += r.packetLossPct;
      acc.reconnections += r.reconnectionEvents;
      acc.iceRestarts += r.iceRestartCount;
      if (r.relayUsed) acc.relayCalls += 1;
      return acc;
    },
    { durationMs: 0, dataBytes: 0, latency: 0, loss: 0, reconnections: 0, iceRestarts: 0, relayCalls: 0 },
  );

  const byNetworkType = rows.reduce<Record<string, number>>((acc: Record<string, number>, r: AnalyticsRow) => {
    const key = r.networkType || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  res.json({
    windowDays: days,
    totalCalls,
    successRate: Number(successRate.toFixed(1)),
    avgLatencyMs: totalCalls > 0 ? Math.round(totals.latency / totalCalls) : 0,
    avgPacketLossPct: totalCalls > 0 ? Number((totals.loss / totalCalls).toFixed(2)) : 0,
    relayRatePct: totalCalls > 0 ? Number(((totals.relayCalls / totalCalls) * 100).toFixed(1)) : 0,
    totalDurationMinutes: Number((totals.durationMs / 60000).toFixed(1)),
    totalDataMb: Number((totals.dataBytes / (1024 * 1024)).toFixed(2)),
    totalReconnections: totals.reconnections,
    totalIceRestarts: totals.iceRestarts,
    byNetworkType,
  });
});

// ── Recording endpoints ───────────────────────────────────────────────────────

/**
 * POST /calls/:id/recording
 * Attach a recording URL (and optional transcript) to a completed call.
 * Only the caller or callee may upload a recording for their own call.
 *
 * Body: { url: string, transcription?: string }
 */
router.post('/:id/recording', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const { id: callId } = req.params;

  const { url, transcription } = req.body as { url?: string; transcription?: string };

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    res.status(400).json({ error: 'Recording URL is required' });
    return;
  }

  // Validate that the recording URL looks like a real URL
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid recording URL' });
    return;
  }

  const call = await prisma.callLog.findUnique({ where: { id: callId } });
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }

  // Only the caller or callee may attach a recording
  if (call.callerId !== userId && call.calleeId !== userId) {
    res.status(403).json({ error: 'Not authorised to update this call' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma.callLog.update as any)({
    where: { id: callId },
    data: {
      recordingUrl: url.trim(),
      ...(transcription ? { transcription: transcription.trim() } : {}),
    },
    select: {
      id: true,
      recordingUrl: true,
      transcription: true,
      startedAt: true,
      endedAt: true,
    },
  });

  res.status(201).json(updated);
});

/**
 * GET /calls/:id/recording
 * Retrieve the recording info for a call.
 * Only the caller or callee may access it.
 */
router.get('/:id/recording', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const { id: callId } = req.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = await (prisma.callLog.findUnique as any)({
    where: { id: callId },
    select: {
      id: true,
      callerId: true,
      calleeId: true,
      recordingUrl: true,
      transcription: true,
      startedAt: true,
      endedAt: true,
      durationMs: true,
    },
  });

  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }

  if (call.callerId !== userId && call.calleeId !== userId) {
    res.status(403).json({ error: 'Not authorised to access this call' });
    return;
  }

  if (!call.recordingUrl) {
    res.status(404).json({ error: 'No recording available for this call' });
    return;
  }

  res.json({
    id: call.id,
    recordingUrl: call.recordingUrl,
    transcription: call.transcription ?? null,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationMs: call.durationMs,
  });
});

export default router;
