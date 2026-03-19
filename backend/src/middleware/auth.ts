// src/middleware/auth.ts
// JWT authentication middleware for Express routes.
// Verifies the Bearer token issued at login and attaches userId to the request.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
