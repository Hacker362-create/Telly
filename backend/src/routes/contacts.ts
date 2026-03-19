// src/routes/contacts.ts
// Contacts/directory endpoint — lets authenticated users search for other
// registered users by name or phone number so they can initiate calls.

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /contacts/search?q=<query>
 * Returns up to 20 users matching the search term (name or phone).
 * The current user is excluded from results.
 * Only minimal public fields are returned — no password hash or billing data.
 */
router.get(
  '/search',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const q = ((req.query.q as string) ?? '').trim();

    if (q.length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: req.userId } },          // exclude self
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phoneNumber: { contains: q } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
      },
      take: 20,
      orderBy: { name: 'asc' },
    });

    res.json({ contacts: users });
  },
);

export default router;
