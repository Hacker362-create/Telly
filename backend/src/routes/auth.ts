// src/routes/auth.ts
// User registration and JWT-based authentication endpoints.

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? 'telly-secret-change-in-production';

// POST /auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
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
router.post('/login', async (req: Request, res: Response): Promise<void> => {
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

export default router;
