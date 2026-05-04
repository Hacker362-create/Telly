import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

export const REFERRAL_BONUS_MINUTES = parseInt(process.env.REFERRAL_BONUS_MINUTES ?? '5', 10);
const REFERRAL_CODE_LENGTH = parseInt(process.env.REFERRAL_CODE_LENGTH ?? '6', 10);
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_REFERRAL_ATTEMPTS = 8;

export function normalizeReferralCode(code?: string | null): string | null {
  if (!code) return null;
  const cleaned = code.trim().toUpperCase();
  return cleaned.length >= 4 ? cleaned : null;
}

function randomReferralCode(): string {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
  let result = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    const idx = bytes[i] % REFERRAL_ALPHABET.length;
    result += REFERRAL_ALPHABET[idx];
  }
  return result;
}

export async function generateReferralCode(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_REFERRAL_ATTEMPTS; attempt += 1) {
    const candidate = randomReferralCode();
    const exists = await prisma.user.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('Unable to generate unique referral code');
}

export async function ensureReferralCode(prisma: PrismaClient, userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  const newCode = await generateReferralCode(prisma);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { referralCode: newCode },
    select: { referralCode: true },
  });
  return updated.referralCode ?? newCode;
}

export async function applyReferralCode(
  prisma: PrismaClient,
  userId: string,
  code: string,
): Promise<{ referrerId: string; bonusMinutes: number }> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) {
    throw new Error('Invalid referral code');
  }

  const [user, referrer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referredBy: true },
    }),
    prisma.user.findUnique({
      where: { referralCode: normalized },
      select: { id: true },
    }),
  ]);

  if (!user) {
    throw new Error('User not found');
  }
  if (user.referredBy) {
    throw new Error('Referral already applied');
  }
  if (!referrer) {
    throw new Error('Referral code not found');
  }
  if (referrer.id === user.id) {
    throw new Error('Self-referral is not allowed');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        referredBy: referrer.id,
        bonusMinutes: { increment: REFERRAL_BONUS_MINUTES },
      },
    }),
    prisma.user.update({
      where: { id: referrer.id },
      data: {
        referralCount: { increment: 1 },
        referralRewardsEarned: { increment: REFERRAL_BONUS_MINUTES },
        bonusMinutes: { increment: REFERRAL_BONUS_MINUTES },
      },
    }),
  ]);

  return { referrerId: referrer.id, bonusMinutes: REFERRAL_BONUS_MINUTES };
}
