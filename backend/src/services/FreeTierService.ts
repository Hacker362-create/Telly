import { PrismaClient } from '@prisma/client';

export const DAILY_FREE_MINUTES = parseInt(process.env.DAILY_FREE_MINUTES ?? '15', 10);

export function getUtcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getNextResetTime(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export async function maybeResetDailyMinutes(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const dayStart = getUtcDayStart(now);
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ lastResetDate: null }, { lastResetDate: { lt: dayStart } }],
    },
    data: {
      dailyMinutesUsed: 0,
      lastResetDate: now,
    },
  });
  return result.count > 0;
}
