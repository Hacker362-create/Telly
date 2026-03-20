// src/routes/messages.ts
// In-app 1-to-1 messaging REST endpoints.
//
// All routes require a valid JWT (requireAuth middleware).
//
// POST   /messages                          – send a message
// GET    /messages/conversation/:peerId     – paginated conversation history
// PATCH  /messages/:id/read                 – mark a single message as read
// GET    /messages/unread/count             – count of unread messages for current user

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import { messagesSentCounter } from '../metrics/registry';
import { sendNewMessagePush } from '../notifications/push';

const router = Router();
const prisma = new PrismaClient();

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_BODY_LENGTH = 4000;

// ── POST /messages ─────────────────────────────────────────────────────────────
/**
 * Send a message to another user.
 *
 * Body: { recipientId: string, body: string }
 *
 * Response:
 *   201  { id, senderId, recipientId, body, sentAt }
 *   400  missing/invalid fields
 *   400  user cannot message themselves
 */
router.post(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const senderId = req.userId as string;
    const { recipientId, body } = req.body as { recipientId?: unknown; body?: unknown };

    if (!recipientId || typeof recipientId !== 'string' || recipientId.trim().length === 0) {
      res.status(400).json({ error: 'recipientId is required' });
      return;
    }

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'body is required' });
      return;
    }

    if (body.trim().length > MAX_BODY_LENGTH) {
      res.status(400).json({ error: `Message body must not exceed ${MAX_BODY_LENGTH} characters` });
      return;
    }

    if (recipientId.trim() === senderId) {
      res.status(400).json({ error: 'Cannot send a message to yourself' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = await (prisma.message as any).create({
      data: {
        senderId,
        recipientId: recipientId.trim(),
        body: body.trim(),
      },
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        body: true,
        sentAt: true,
      },
    });

    messagesSentCounter.inc();

    // Fire-and-forget push notification to the recipient's device.
    // We don't have a display name in this request; use senderId as fallback.
    sendNewMessagePush(recipientId.trim(), {
      senderId,
      senderName: senderId,
      preview: body.trim(),
    }).catch((err) => console.error('[Messages] Push failed:', err));

    res.status(201).json(message);
  },
);

// ── GET /messages/unread/count ─────────────────────────────────────────────────
/**
 * Return the total number of unread messages received by the current user.
 * Must be registered BEFORE the /:id routes to avoid param capture.
 *
 * Response:
 *   200  { unreadCount: number }
 */
router.get(
  '/unread/count',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unreadCount = await (prisma.message as any).count({
      where: { recipientId: userId, readAt: null },
    });

    res.json({ unreadCount });
  },
);

// ── GET /messages/conversation/:peerId ────────────────────────────────────────
/**
 * Return a paginated list of messages exchanged between the current user
 * and a peer, ordered oldest-first within each page.
 *
 * Query params:
 *   page  – 1-based page number (default 1)
 *   limit – items per page (default 20, max 50)
 *
 * Response:
 *   200  { messages: [...], pagination: { page, limit, total, pages, hasMore } }
 */
router.get(
  '/conversation/:peerId',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { peerId } = req.params;

    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.limit as string ?? String(DEFAULT_PAGE_SIZE), 10)),
    );

    const where = {
      OR: [
        { senderId: userId, recipientId: peerId },
        { senderId: peerId, recipientId: userId },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [total, messages] = await Promise.all([
      (prisma.message as any).count({ where }),
      (prisma.message as any).findMany({
        where,
        orderBy: { sentAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          body: true,
          sentAt: true,
          readAt: true,
        },
      }),
    ]);

    res.json({
      messages,
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

// ── PATCH /messages/:id/read ──────────────────────────────────────────────────
/**
 * Mark a received message as read.
 * Only the recipient may mark a message read.
 *
 * Response:
 *   200  { id, readAt }
 *   403  caller is not the recipient
 *   404  message not found
 *   409  message already marked read
 */
router.patch(
  '/:id/read',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { id } = req.params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = await (prisma.message as any).findUnique({
      where: { id },
      select: { id: true, recipientId: true, readAt: true },
    });

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.recipientId !== userId) {
      res.status(403).json({ error: 'Not authorised to mark this message as read' });
      return;
    }

    if (message.readAt) {
      res.status(409).json({ error: 'Message already marked as read', readAt: message.readAt });
      return;
    }

    const readAt = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.message as any).update({
      where: { id },
      data: { readAt },
    });

    res.json({ id, readAt });
  },
);

export default router;
