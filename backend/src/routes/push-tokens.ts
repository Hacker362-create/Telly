// src/routes/push-tokens.ts
// Device push-token registration REST endpoints.
//
// Clients call these endpoints after login to register (or remove) their
// device token so the server can deliver background push notifications
// even when the app is killed or in battery-saver mode.
//
// All routes require a valid JWT (requireAuth middleware).
//
// POST   /push-tokens   – register a device token for the current user
// DELETE /push-tokens   – deregister the device token for the current user

import { Router, Response } from 'express';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import {
  storeTokenForPlatform,
  deleteTokenForPlatform,
  PushPlatform,
} from '../notifications/push';
import { pushTokensRegisteredCounter } from '../metrics/registry';

const router = Router();

const VALID_PLATFORMS: PushPlatform[] = ['fcm', 'apns'];

// ── POST /push-tokens ─────────────────────────────────────────────────────────
/**
 * Register a device push token.
 *
 * Body: { token: string, platform: 'fcm' | 'apns' }
 *
 * Response:
 *   200  { ok: true }
 *   400  missing or invalid fields
 */
router.post(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { token, platform } = req.body as { token?: unknown; platform?: unknown };

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    if (!platform || !VALID_PLATFORMS.includes(platform as PushPlatform)) {
      res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
      return;
    }

    await storeTokenForPlatform(userId, token.trim(), platform as PushPlatform);
    pushTokensRegisteredCounter.inc({ platform: platform as string });

    res.json({ ok: true });
  },
);

// ── DELETE /push-tokens ───────────────────────────────────────────────────────
/**
 * Deregister a device push token (e.g. on logout or when the user opts out
 * of notifications).
 *
 * Body: { platform: 'fcm' | 'apns' }
 *
 * Response:
 *   200  { ok: true }
 *   400  missing or invalid fields
 */
router.delete(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const { platform } = req.body as { platform?: unknown };

    if (!platform || !VALID_PLATFORMS.includes(platform as PushPlatform)) {
      res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
      return;
    }

    await deleteTokenForPlatform(userId, platform as PushPlatform);

    res.json({ ok: true });
  },
);

export default router;
