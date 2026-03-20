// src/routes/voicemail.ts
// Voicemail REST endpoints.
//
// All routes require a valid JWT (requireAuth middleware).
//
// POST   /voicemail                          – leave a voicemail for another user
// GET    /voicemail                          – list voicemails received by current user
// GET    /voicemail/unlistened/count         – count of unlistened voicemails
// GET    /voicemail/:id                      – get a single voicemail (caller or recipient)
// PATCH  /voicemail/:id/listen               – mark a voicemail as listened
// DELETE /voicemail/:id                      – delete a voicemail (recipient only)

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import { voicemailsLeftCounter } from '../metrics/registry';

const router = Router();
const prisma = new PrismaClient();

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_AUDIO_URL_LENGTH = 2048;
const MAX_DURATION_SEC = 3 * 60; // 3 minutes

// ── POST /voicemail ────────────────────────────────────────────────────────────
/**
 * Leave a voicemail for another user.
 *
 * Body: { recipientId: string, audioUrl: string, durationSec: number, transcription?: string }
 *
 * Response:
 *   201  { id, callerId, recipientId, audioUrl, durationSec, transcription, leftAt }
 *   400  missing/invalid fields
 *   400  caller cannot leave a voicemail for themselves
 */
router.post(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const callerId = req.userId as string;
    const { recipientId, audioUrl, durationSec, transcription } = req.body as {
      recipientId?: unknown;
      audioUrl?: unknown;
      durationSec?: unknown;
      transcription?: unknown;
    };

    if (!recipientId || typeof recipientId !== 'string' || recipientId.trim().length === 0) {
      res.status(400).json({ error: 'recipientId is required' });
      return;
    }

    if (recipientId.trim() === callerId) {
      res.status(400).json({ error: 'Cannot leave a voicemail for yourself' });
      return;
    }

    if (!audioUrl || typeof audioUrl !== 'string' || audioUrl.trim().length === 0) {
      res.status(400).json({ error: 'audioUrl is required' });
      return;
    }

    if (audioUrl.trim().length > MAX_AUDIO_URL_LENGTH) {
      res.status(400).json({ error: `audioUrl must not exceed ${MAX_AUDIO_URL_LENGTH} characters` });
      return;
    }

    if (
      durationSec === undefined ||
      durationSec === null ||
      typeof durationSec !== 'number' ||
      !Number.isInteger(durationSec) ||
      durationSec <= 0
    ) {
      res.status(400).json({ error: 'durationSec must be a positive integer' });
      return;
    }

    if (durationSec > MAX_DURATION_SEC) {
      res.status(400).json({ error: `durationSec must not exceed ${MAX_DURATION_SEC} seconds` });
      return;
    }

    if (transcription !== undefined && transcription !== null && typeof transcription !== 'string') {
      res.status(400).json({ error: 'transcription must be a string' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voicemail = await (prisma.voicemail as any).create({
      data: {
        callerId,
        recipientId: recipientId.trim(),
        audioUrl: audioUrl.trim(),
        durationSec,
        transcription: typeof transcription === 'string' ? transcription.trim() : null,
      },
      select: {
        id: true,
        callerId: true,
        recipientId: true,
        audioUrl: true,
        durationSec: true,
        transcription: true,
        leftAt: true,
      },
    });

    voicemailsLeftCounter.inc();
    res.status(201).json(voicemail);
  },
);

// ── GET /voicemail/unlistened/count ────────────────────────────────────────────
/**
 * Return the total number of unlistened voicemails received by the current user.
 * Must be registered BEFORE the /:id routes to avoid param capture.
 *
 * Response:
 *   200  { unlistenedCount: number }
 */
router.get(
  '/unlistened/count',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unlistenedCount = await (prisma.voicemail as any).count({
      where: { recipientId: userId, listenedAt: null },
    });

    res.json({ unlistenedCount });
  },
);

// ── GET /voicemail ─────────────────────────────────────────────────────────────
/**
 * Return a paginated list of voicemails received by the current user,
 * ordered newest-first.
 *
 * Query params:
 *   page  – 1-based page number (default 1)
 *   limit – items per page (default 20, max 50)
 *
 * Response:
 *   200  { voicemails: [...], pagination: { page, limit, total, pages, hasMore } }
 */
router.get(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;

    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.limit as string ?? String(DEFAULT_PAGE_SIZE), 10)),
    );

    const where = { recipientId: userId };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [total, voicemails] = await Promise.all([
      (prisma.voicemail as any).count({ where }),
      (prisma.voicemail as any).findMany({
        where,
        orderBy: { leftAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          callerId: true,
          recipientId: true,
          audioUrl: true,
          durationSec: true,
          transcription: true,
          leftAt: true,
          listenedAt: true,
        },
      }),
    ]);

    res.json({
      voicemails,
      pagination: {
        page,
        limit,
        total,
        pages: total === 0 ? 0 : Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  },
);

// ── GET /voicemail/:id ─────────────────────────────────────────────────────────
/**
 * Get a single voicemail by ID.
 * Only the caller or recipient may view it.
 *
 * Response:
 *   200  { id, callerId, recipientId, audioUrl, durationSec, transcription, leftAt, listenedAt }
 *   403  caller is neither sender nor recipient
 *   404  voicemail not found
 */
router.get(
  '/:id',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { id } = req.params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voicemail = await (prisma.voicemail as any).findUnique({
      where: { id },
      select: {
        id: true,
        callerId: true,
        recipientId: true,
        audioUrl: true,
        durationSec: true,
        transcription: true,
        leftAt: true,
        listenedAt: true,
      },
    });

    if (!voicemail) {
      res.status(404).json({ error: 'Voicemail not found' });
      return;
    }

    if (voicemail.callerId !== userId && voicemail.recipientId !== userId) {
      res.status(403).json({ error: 'Not authorised to view this voicemail' });
      return;
    }

    res.json(voicemail);
  },
);

// ── PATCH /voicemail/:id/listen ───────────────────────────────────────────────
/**
 * Mark a received voicemail as listened.
 * Only the recipient may mark a voicemail as listened.
 *
 * Response:
 *   200  { id, listenedAt }
 *   403  caller is not the recipient
 *   404  voicemail not found
 *   409  voicemail already marked as listened
 */
router.patch(
  '/:id/listen',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { id } = req.params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voicemail = await (prisma.voicemail as any).findUnique({
      where: { id },
      select: { id: true, recipientId: true, listenedAt: true },
    });

    if (!voicemail) {
      res.status(404).json({ error: 'Voicemail not found' });
      return;
    }

    if (voicemail.recipientId !== userId) {
      res.status(403).json({ error: 'Not authorised to mark this voicemail as listened' });
      return;
    }

    if (voicemail.listenedAt) {
      res.status(409).json({ error: 'Voicemail already marked as listened', listenedAt: voicemail.listenedAt });
      return;
    }

    const listenedAt = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.voicemail as any).update({
      where: { id },
      data: { listenedAt },
    });

    res.json({ id, listenedAt });
  },
);

// ── DELETE /voicemail/:id ──────────────────────────────────────────────────────
/**
 * Delete a voicemail.
 * Only the recipient may delete a voicemail.
 *
 * Response:
 *   204  (no body)
 *   403  caller is not the recipient
 *   404  voicemail not found
 */
router.delete(
  '/:id',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { id } = req.params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voicemail = await (prisma.voicemail as any).findUnique({
      where: { id },
      select: { id: true, recipientId: true },
    });

    if (!voicemail) {
      res.status(404).json({ error: 'Voicemail not found' });
      return;
    }

    if (voicemail.recipientId !== userId) {
      res.status(403).json({ error: 'Not authorised to delete this voicemail' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.voicemail as any).delete({ where: { id } });

    res.status(204).send();
  },
);

export default router;
