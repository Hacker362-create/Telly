// src/routes/contacts.ts
// Contacts/directory endpoint — lets authenticated users search for other
// registered users by name, phone number, or Telly ID so they can initiate calls.

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /contacts/search?q=<query>
 * Returns up to 20 users matching the search term (name, phone, or Telly ID).
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

    try {
      // Search by Telly ID
      const tellyMatches = await prisma.tellyID.findMany({
        where: {
          OR: [
            { tellyId: { contains: q } },
            { vanityId: { contains: q } },
          ],
        },
        select: { userId: true },
      });

      const tellyUserIds = tellyMatches.map(t => t.userId);

      // Build dynamic OR clause based on whether we found Telly ID matches
      const orConditions: any[] = [
        { name: { contains: q } },
        { phoneNumber: { contains: q } },
      ];
      
      if (tellyUserIds.length > 0) {
        orConditions.push({ id: { in: tellyUserIds } });
      }

      const users = await prisma.user.findMany({
        where: {
          AND: [
            { id: { not: req.userId } },          // exclude self
            { OR: orConditions },
          ],
        },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          tellyId: {
            select: {
              tellyId: true,
              vanityId: true,
            },
          },
        },
        take: 20,
        orderBy: { name: 'asc' },
      });

      // Transform response to include tellyId at top level
      const contacts = users.map(u => ({
        id: u.id,
        name: u.name,
        phoneNumber: u.phoneNumber,
        tellyId: u.tellyId?.vanityId || u.tellyId?.tellyId || null,
      }));

      res.json({ contacts });
    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  },
);

export default router;
