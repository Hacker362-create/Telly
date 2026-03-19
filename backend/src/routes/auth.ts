// src/routes/auth.ts
// User registration and JWT-based authentication endpoints.
// Includes rate limiting on login/register to prevent brute-force attacks.

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? 'telly-secret-change-in-production';

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
  const { name, email, password, phoneNumber } = req.body as {
    name: string;
    email: string;
    password: string;
    phoneNumber: string;
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, phoneNumber, isActive: false, subscriptionExpiry: new Date() },
    select: { id: true, name: true, email: true, phoneNumber: true },
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ user, token });
});

// POST /auth/login
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, phoneNumber: user.phoneNumber },
    token,
  });
});

// GET /auth/me — return the authenticated user's profile
router.get('/me', apiLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
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
