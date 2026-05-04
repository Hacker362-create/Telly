// src/routes/auth.ts
// User registration and JWT-based authentication endpoints.
// Includes rate limiting on login/register to prevent brute-force attacks.

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import { createTellyID, getEffectiveTellyID } from '../services/TellyIDService';
import {
  applyReferralCode,
  generateReferralCode,
  normalizeReferralCode,
} from '../services/ReferralService';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? 'telly-secret-change-in-production';
const DEFAULT_ADMIN_EMAIL = 'jerryphisael@gmail.com';

function configuredAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS?.trim();
  const emails = (raw && raw.length > 0 ? raw : DEFAULT_ADMIN_EMAIL)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(emails);
}

function isConfiguredAdminEmail(email: string): boolean {
  return configuredAdminEmails().has(email.trim().toLowerCase());
}

/** 5 attempts per 15 minutes per IP — protects register and login endpoints. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later' },
  skip: () => process.env.NODE_ENV === 'test',
});

// POST /auth/register
router.post('/register', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, phoneNumber, referralCode, deviceId } = req.body as {
    name: string;
    email: string;
    password: string;
    phoneNumber: string;
    referralCode?: string;
    deviceId?: string;
  };

  if (!name || !email || !password || !phoneNumber) {
    res.status(400).json({ error: 'All fields are required' });
    return;
  }

  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  // E.164 phone number validation (e.g. +254712345678)
  if (!/^\+\d{7,15}$/.test(phoneNumber)) {
    res.status(400).json({ error: 'Phone number must be in E.164 format (e.g. +254712345678)' });
    return;
  }

  // Minimum password length
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedDeviceId = typeof deviceId === 'string' && deviceId.trim().length > 0
    ? deviceId.trim()
    : null;

  if (deviceId && !normalizedDeviceId) {
    res.status(400).json({ error: 'Invalid device id' });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  if (normalizedDeviceId) {
    const deviceMatch = await (prisma as unknown as {
      user: { findFirst: (args: unknown) => Promise<{ id: string } | null> }
    }).user.findFirst({
      where: { deviceId: normalizedDeviceId },
      select: { id: true },
    });
    if (deviceMatch) {
      res.status(409).json({ error: 'This device is already registered' });
      return;
    }
  }

  const normalizedReferral = normalizeReferralCode(referralCode);
  let referrerId: string | null = null;
  if (referralCode) {
    if (!normalizedReferral) {
      res.status(400).json({ error: 'Invalid referral code' });
      return;
    }
    const referrer = await prisma.user.findUnique({
      where: { referralCode: normalizedReferral },
      select: { id: true },
    });
    if (!referrer) {
      res.status(404).json({ error: 'Referral code not found' });
      return;
    }
    referrerId = referrer.id;
  }

  const newReferralCode = await generateReferralCode(prisma);

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await (prisma as unknown as {
    user: { create: (args: unknown) => Promise<{ id: string; name: string; email: string; phoneNumber: string; isAdmin?: boolean }> }
  }).user.create({
    data: {
      name,
      email: normalizedEmail,
      passwordHash,
      phoneNumber,
      isAdmin: isConfiguredAdminEmail(normalizedEmail),
      isActive: false,
      subscriptionExpiry: new Date(),
      referralCode: newReferralCode,
      deviceId: normalizedDeviceId,
    },
    select: { id: true, name: true, email: true, phoneNumber: true, isAdmin: true },
  });

  if (referrerId && normalizedReferral) {
    try {
      await applyReferralCode(prisma, user.id, normalizedReferral);
    } catch (error) {
      console.error('Failed to apply referral code:', error);
    }
  }

  // Auto-generate Telly ID for new user
  let tellyId: string | null = null;
  try {
    tellyId = await createTellyID(user.id, user.email);
  } catch (error) {
    console.error('Failed to create Telly ID during signup:', error);
    // Continue signup flow even if Telly ID creation fails
  }

  const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ user, token, tellyId });
});

// POST /auth/login
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };
  const normalizedEmail = email.trim().toLowerCase();

  const user = await (prisma as unknown as {
    user: { findUnique: (args: unknown) => Promise<{ id: string; name: string; email: string; phoneNumber: string; passwordHash: string; isAdmin?: boolean } | null> }
  }).user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  let isAdmin = user.isAdmin;
  if (!isAdmin && isConfiguredAdminEmail(user.email)) {
    await (prisma as unknown as {
      user: { update: (args: unknown) => Promise<unknown> }
    }).user.update({
      where: { id: user.id },
      data: { isAdmin: true },
    });
    isAdmin = true;
  }

  let tellyId: string | null = null;
  try {
    tellyId = await getEffectiveTellyID(user.id);
    if (!tellyId) {
      tellyId = await createTellyID(user.id, user.email);
    }
  } catch (error) {
    console.error('Failed to resolve/create Telly ID during login:', error);
  }

  const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, phoneNumber: user.phoneNumber, isAdmin },
    token,
    tellyId,
  });
});

// GET /auth/me — return the authenticated user's profile
router.get('/me', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await (prisma as unknown as {
    user: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }
  }).user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      isAdmin: true,
      isActive: true,
      subscriptionExpiry: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

export default router;
