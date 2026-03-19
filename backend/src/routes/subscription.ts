// src/routes/subscription.ts
// REST endpoints for subscription management: initiate payment, handle M-Pesa callback,
// and query subscription status.

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createMpesaClient, MpesaClient, PaymentCallback } from '../billing/mpesa';

const router = Router();
const prisma = new PrismaClient();
const mpesa = createMpesaClient();

// POST /subscription/initiate - Start M-Pesa STK push for KES 500 subscription
router.post('/initiate', async (req: Request, res: Response): Promise<void> => {
  const { userId, phoneNumber } = req.body as { userId: string; phoneNumber: string };

  if (!userId || !phoneNumber) {
    res.status(400).json({ error: 'userId and phoneNumber are required' });
    return;
  }

  const billingPeriod = new Date().toISOString().slice(0, 7); // e.g. "2024-03"
  const idempotencyKey = MpesaClient.generateIdempotencyKey(userId, billingPeriod);

  try {
    const result = await mpesa.initiateSTKPush(
      {
        phoneNumber,
        amount: 500,
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
router.post('/callback', async (req: Request, res: Response): Promise<void> => {
  const callback = req.body as PaymentCallback;
  const parsed = MpesaClient.parseCallback(callback);

  if (parsed.success) {
    // Extract userId from AccountReference stored in M-Pesa metadata
    const accountRef = callback.Body.stkCallback.CallbackMetadata?.Item
      .find((i) => i.Name === 'AccountReference')?.Value as string | undefined;
    const userId = accountRef?.replace('TELLY-', '');

    if (userId) {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);

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
router.get('/status/:userId', async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

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
