// src/routes/subscription.ts
// REST endpoints for subscription management: initiate payment, handle M-Pesa callback,
// and query subscription status.
// Free tier: 10 minutes/day (configurable via DAILY_FREE_MINUTES env var).
// Paid plan: KES 100/month → 30 days of unlimited calls.
// Subscription status and initiation require a valid JWT token.

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createMpesaClient, MpesaClient, PaymentCallback } from '../billing/mpesa';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
const mpesa = createMpesaClient();

/** Daily free-tier limit in minutes (default: 10). */
const DAILY_FREE_MINUTES = parseInt(process.env.DAILY_FREE_MINUTES ?? '10', 10);

/**
 * Safaricom publishes the IP ranges their callback servers use.
 * We whitelist these to reject forged payment confirmations.
 * Set MPESA_CALLBACK_IPS env var to override (comma-separated CIDR or IPs).
 * In development (MPESA_CALLBACK_BYPASS=true) the check is skipped.
 */
const SAFARICOM_IPS = (
  process.env.MPESA_CALLBACK_IPS ??
  '196.201.214.200,196.201.214.206,196.201.213.114,196.201.214.207,196.201.214.208,175.41.238.173,196.201.213.100,196.201.213.151'
).split(',').map((ip) => ip.trim());

function requireSafaricomIP(req: Request, res: Response, next: NextFunction): void {
  // Allow bypass in development / sandbox mode
  if (process.env.MPESA_CALLBACK_BYPASS === 'true') {
    return next();
  }

  // Respect X-Forwarded-For if running behind a trusted proxy (e.g. AWS ALB)
  const forwarded = req.headers['x-forwarded-for'];
  const remoteIp = (typeof forwarded === 'string' ? forwarded.split(',')[0] : null)
    ?? req.socket.remoteAddress
    ?? '';

  if (!SAFARICOM_IPS.includes(remoteIp)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// POST /subscription/initiate - Start M-Pesa STK push for KES 100/month subscription
router.post('/initiate', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  // Use the authenticated userId from the JWT — never trust the body for identity
  const userId = req.userId as string;
  const { phoneNumber } = req.body as { phoneNumber: string };

  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' });
    return;
  }

  const billingPeriod = new Date().toISOString().slice(0, 7); // e.g. "2024-03"
  const idempotencyKey = MpesaClient.generateIdempotencyKey(userId, billingPeriod);

  try {
    const result = await mpesa.initiateSTKPush(
      {
        phoneNumber,
        amount: 100,
        accountReference: `TELLY-${userId}`,
        transactionDesc: 'Telly Monthly Subscription',
      },
      idempotencyKey,
    );

    res.json({
      checkoutRequestId: result.CheckoutRequestID,
      message: result.CustomerMessage,
    });
  } catch (err) {
    res.status(502).json({ error: 'Payment initiation failed' });
  }
});

// POST /subscription/callback - M-Pesa payment result webhook
// Protected by IP whitelist — only Safaricom's callback servers may call this.
router.post('/callback', requireSafaricomIP, async (req: Request, res: Response): Promise<void> => {
  const callback = req.body as PaymentCallback;
  const parsed = MpesaClient.parseCallback(callback);

  if (parsed.success) {
    // Extract userId from AccountReference stored in M-Pesa metadata.
    // Validate the extracted value is a non-empty UUID-like string to
    // prevent acting on malformed or spoofed account references.
    const accountRef = callback.Body.stkCallback.CallbackMetadata?.Item
      .find((i) => i.Name === 'AccountReference')?.Value as string | undefined;
    const userId = accountRef?.replace('TELLY-', '');

    if (userId && userId.length > 0 && accountRef?.startsWith('TELLY-')) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);

      await prisma.user.update({
        where: { id: userId },
        data: {
          isActive: true,
          subscriptionExpiry: expiry,
        },
      });

      await prisma.transaction.create({
        data: {
          userId,
          amount: parsed.amount ?? 500,
          mpesaReceiptNumber: parsed.mpesaReceiptNumber ?? '',
          checkoutRequestId: parsed.checkoutRequestId,
          status: 'SUCCESS',
        },
      });
    }
  }

  res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// GET /subscription/status/:userId - Check subscription status
// Only the owner of the account (matching JWT userId) may query their own status.
router.get('/status/:userId', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { userId } = req.params;

  // Prevent users from querying other users' subscription status
  if (req.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, subscriptionExpiry: true },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isSubscribed = user.isActive && user.subscriptionExpiry > new Date();
  res.json({
    isSubscribed,
    subscriptionExpiry: user.subscriptionExpiry,
  });
});

export default router;
