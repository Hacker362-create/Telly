// src/routes/calls.ts
// REST endpoints for call history.
// Allows authenticated users to retrieve a paginated list of their past calls.

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

export default router;
