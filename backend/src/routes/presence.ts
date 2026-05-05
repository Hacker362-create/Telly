// src/routes/presence.ts
// REST endpoints for querying user presence status.
//
// GET  /presence/:userId          – single user presence
// POST /presence/batch            – bulk presence for a list of user IDs
//
// Both endpoints require a valid JWT. Presence data is read from Redis
// (via PresenceStore) and is updated in real-time by the signaling server
// on socket connect/disconnect/heartbeat events.

import { Router, Response } from 'express';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import {
  getPresence,
  getPresenceBatch,
  PresenceRecord,
} from '../presence/PresenceStore';

const router = Router();

const MAX_BATCH_SIZE = 100;

/**
 * GET /presence/:userId
 * Returns the presence record of a single user.
 *
 * Response:
 *   200  { userId, status, updatedAt }
 *   400  userId missing or invalid
 */
router.get(
  '/:userId',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { userId } = req.params;

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const record: PresenceRecord = await getPresence(userId);
    res.json({ userId, ...record });
  },
);

/**
 * POST /presence/batch
 * Returns presence records for an array of user IDs.
 * Useful for enriching a contact list with real-time status.
 *
 * Body:   { userIds: string[] }
 * Response:
 *   200  { presence: { [userId]: { status, updatedAt } } }
 *   400  userIds missing, not an array, or too large (> 100)
 */
router.post(
  '/batch',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { userIds } = req.body as { userIds?: unknown };

    if (!Array.isArray(userIds)) {
      res.status(400).json({ error: 'userIds must be an array' });
      return;
    }

    if (userIds.length === 0) {
      res.json({ presence: {} });
      return;
    }

    if (userIds.length > MAX_BATCH_SIZE) {
      res
        .status(400)
        .json({ error: `userIds must contain at most ${MAX_BATCH_SIZE} entries` });
      return;
    }

    // Ensure every element is a non-empty string
    if (!userIds.every((id) => typeof id === 'string' && id.length > 0)) {
      res.status(400).json({ error: 'All userIds must be non-empty strings' });
      return;
    }

    const presence = await getPresenceBatch(userIds as string[]);
    res.json({ presence });
  },
);

export default router;
