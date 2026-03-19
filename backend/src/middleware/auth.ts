// src/middleware/auth.ts
// JWT authentication middleware for Express routes.
// Also exports a general-purpose API rate limiter for authenticated endpoints.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';

const JWT_SECRET = process.env.JWT_SECRET ?? 'telly-secret-change-in-production';

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
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
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
