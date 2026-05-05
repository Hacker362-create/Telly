import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import { applyReferralCode, ensureReferralCode, normalizeReferralCode } from '../services/ReferralService';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /referral/me
 * Return the authenticated user's referral code and stats.
 */
router.get('/me', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      referralCode: true,
      referralCount: true,
      referralRewardsEarned: true,
      bonusMinutes: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const referralCode = user.referralCode ?? await ensureReferralCode(prisma, userId);

  res.json({
    referralCode,
    referralCount: user.referralCount ?? 0,
    referralRewardsEarned: user.referralRewardsEarned ?? 0,
    bonusMinutes: user.bonusMinutes ?? 0,
  });
});

/**
 * POST /referral/use
 * Apply a referral code for the authenticated user.
 */
router.post('/use', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const { referralCode } = req.body as { referralCode?: string };
  const normalized = normalizeReferralCode(referralCode);

  if (!normalized) {
    res.status(400).json({ error: 'Invalid referral code' });
    return;
  }

  try {
    await applyReferralCode(prisma, userId, normalized);
    res.json({ ok: true, referralCode: normalized });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to apply referral code';
    const status = message === 'Referral already applied' ? 409
      : message === 'Self-referral is not allowed' ? 400
        : message === 'Referral code not found' ? 404
          : message === 'User not found' ? 404
            : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
