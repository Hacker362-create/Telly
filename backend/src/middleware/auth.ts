// src/middleware/auth.ts
// JWT authentication middleware for Express routes.
// Also exports a general-purpose API rate limiter for authenticated endpoints.

import { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';

const JWT_SECRET = process.env.JWT_SECRET ?? 'telly-secret-change-in-production';
let prismaSingleton: {
  user: { findUnique: (args: unknown) => Promise<{ isAdmin?: boolean } | null> }
} | null = null;

function getPrismaForAdminCheck(): {
  user: { findUnique: (args: unknown) => Promise<{ isAdmin?: boolean } | null> }
} {
  if (prismaSingleton) return prismaSingleton;
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  prismaSingleton = new PrismaClient() as unknown as {
    user: { findUnique: (args: unknown) => Promise<{ isAdmin?: boolean } | null> }
  };
  return prismaSingleton;
}

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * Express middleware that requires a valid JWT Bearer token.
 * Attaches `req.userId` for downstream handlers.
 */
export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * General-purpose rate limiter for authenticated API endpoints.
 * Allows 60 requests per minute per IP — enough for normal usage but
 * prevents enumeration and abusive scraping.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down' },
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * Requires a valid JWT and admin user role.
 */
export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  requireAuth(req, res, async () => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }

    const user = await getPrismaForAdminCheck().user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    next();
  });
}
