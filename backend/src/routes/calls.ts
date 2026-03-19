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
