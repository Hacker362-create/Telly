import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const MAX_LOG_LENGTH = 5000;

function normalizeLogs(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed.slice(0, MAX_LOG_LENGTH) : null;
  }
  try {
    const json = JSON.stringify(input);
    return json.length > 0 ? json.slice(0, MAX_LOG_LENGTH) : null;
  } catch {
    return null;
  }
}

router.post('/', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const { message, logs, platform, appVersion } = req.body as {
    message?: string;
    logs?: unknown;
    platform?: string;
    appVersion?: string;
  };

  const trimmed = message?.trim();
  if (!trimmed) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const record = await prisma.feedback.create({
    data: {
      userId,
      message: trimmed,
      logs: normalizeLogs(logs),
      platform: typeof platform === 'string' ? platform : null,
      appVersion: typeof appVersion === 'string' ? appVersion : null,
    },
    select: {
      id: true,
      message: true,
      createdAt: true,
    },
  });

  res.status(201).json(record);
});

export default router;
