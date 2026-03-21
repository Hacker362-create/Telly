import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADJECTIVES = [
  'quick', 'lazy', 'happy', 'sad', 'bright', 'dark', 'fast', 'slow',
  'hot', 'cold', 'wet', 'dry', 'big', 'small', 'tall', 'short',
  'loud', 'quiet', 'fresh', 'stale', 'smooth', 'rough', 'sweet', 'bitter',
];

const NOUNS = [
  'lion', 'tiger', 'eagle', 'dolphin', 'wolf', 'panda', 'snake', 'bear',
  'fox', 'rabbit', 'deer', 'whale', 'shark', 'eagle', 'owl', 'raven',
  'dragon', 'phoenix', 'unicorn', 'pegasus', 'cheetah', 'panther', 'lynx', 'hawk',
];

const MAX_ID_LENGTH = 16;
const MAX_RETRIES = 5;

interface GeneratedID {
  tellyId: string;
  baseUsername: string;
  numericSuffix: number;
}

/**
 * Sanitize and extract username from email
 * @example "john.smith@gmail.com" -> "johnsmith"
 */
export function extractUsernameFromEmail(email: string): string {
  const [localPart] = email.split('@');
  // Remove all non-alphanumeric characters and convert to lowercase
  const cleaned = localPart.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  // Limit to 10 characters
  return cleaned.slice(0, 10);
}

/**
 * Generate random number between 0-99
 */
export function generateRandomSuffix(): number {
  return Math.floor(Math.random() * 100);
}

/**
 * Generate single-digit random number between 0-9
 */
export function generateRandomDigit(): number {
  return Math.floor(Math.random() * 10);
}

/**
 * Generate a numeric suffix that fits within MAX_ID_LENGTH for a given base.
 */
export function generateSuffixForBase(baseUsername: string): number {
  const availableDigits = MAX_ID_LENGTH - baseUsername.length - 1; // minus separator '-'
  if (availableDigits <= 0) {
    throw new Error(
      `Base username is too long to format Telly ID: ${baseUsername}`
    );
  }

  // Keep suffixes in the same practical range while respecting available space.
  if (availableDigits === 1) {
    return generateRandomDigit();
  }

  return generateRandomSuffix();
}

/**
 * Generate fallback random ID (adjective-noun-number)
 */
export function generateFallbackID(): { baseUsername: string; suffix: number } {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = generateRandomDigit(); // Use single-digit for fallback to stay within 16 char limit
  return {
    baseUsername: `${adj}-${noun}`,
    suffix,
  };
}

/**
 * Format Telly ID with validation
 */
export function formatTellyID(baseUsername: string, suffix: number): string {
  const formatted = `${baseUsername}-${suffix}`;
  if (formatted.length > MAX_ID_LENGTH) {
    throw new Error(
      `Generated Telly ID exceeds max length of ${MAX_ID_LENGTH}: ${formatted}`
    );
  }
  // Validate only letters, numbers, and hyphens
  if (!/^[a-z0-9-]+$/.test(formatted)) {
    throw new Error(
      `Generated Telly ID contains invalid characters: ${formatted}`
    );
  }
  return formatted;
}

/**
 * Check if Telly ID already exists
 */
export async function tellyIDExists(tellyId: string): Promise<boolean> {
  const existing = await prisma.tellyID.findUnique({
    where: { tellyId },
  });
  return !!existing;
}

/**
 * Generate a unique Telly ID with collision handling
 */
export async function generateUniqueTellyID(
  email: string
): Promise<string> {
  let baseUsername = extractUsernameFromEmail(email);

  // If email extraction fails or is too short, use fallback
  if (baseUsername.length < 3) {
    const fallback = generateFallbackID();
    baseUsername = fallback.baseUsername;
  }

  // Try to find a unique suffix
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const suffix = generateSuffixForBase(baseUsername);
    const tellyId = formatTellyID(baseUsername, suffix);

    const exists = await tellyIDExists(tellyId);
    if (!exists) {
      return tellyId;
    }
  }

  // Fallback: use adjective-noun if initial approach fails
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const fallback = generateFallbackID();
    const tellyId = formatTellyID(fallback.baseUsername, fallback.suffix);

    const exists = await tellyIDExists(tellyId);
    if (!exists) {
      return tellyId;
    }
  }

  throw new Error(
    'Unable to generate unique Telly ID after maximum retries'
  );
}

/**
 * Create and persist a Telly ID for a new user
 */
export async function createTellyID(userId: string, email: string): Promise<string> {
  try {
    const email_base = extractUsernameFromEmail(email);
    let baseUsername = email_base;
    let numericSuffix = 0;

    if (baseUsername.length >= 3) {
      // Try with numeric suffix
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        numericSuffix = generateSuffixForBase(baseUsername);
        const tellyId = formatTellyID(baseUsername, numericSuffix);
        if (!(await tellyIDExists(tellyId))) {
          const tellyIDRecord = await prisma.tellyID.create({
            data: {
              userId,
              tellyId,
              baseUsername,
              numericSuffix,
            },
          });
          return tellyIDRecord.tellyId;
        }
      }
    }

    // Fallback to adjective-noun
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const fallback = generateFallbackID();
      const tellyId = formatTellyID(fallback.baseUsername, fallback.suffix);
      if (!(await tellyIDExists(tellyId))) {
        const tellyIDRecord = await prisma.tellyID.create({
          data: {
            userId,
            tellyId,
            baseUsername: fallback.baseUsername,
            numericSuffix: fallback.suffix,
          },
        });
        return tellyIDRecord.tellyId;
      }
    }

    throw new Error(
      'Unable to generate unique Telly ID after maximum retries'
    );
  } catch (error) {
    console.error('Failed to create Telly ID:', error);
    throw new Error(`Failed to create Telly ID for user ${userId}`);
  }
}

/**
 * Get Telly ID for a user
 */
export async function getTellyID(userId: string): Promise<string | null> {
  try {
    const tellyID = await prisma.tellyID.findUnique({
      where: { userId },
      select: { tellyId: true },
    });
    return tellyID?.tellyId ?? null;
  } catch (error) {
    console.error('Failed to fetch Telly ID:', error);
    return null;
  }
}

/**
 * Resolve Telly ID to user ID
 */
export async function resolveTellyIDToUserId(tellyId: string): Promise<string | null> {
  try {
    const record = await prisma.tellyID.findUnique({
      where: { tellyId },
      select: { userId: true },
    });
    return record?.userId ?? null;
  } catch (error) {
    console.error('Failed to resolve Telly ID:', error);
    return null;
  }
}

/**
 * Assign vanity ID to premium user (admin only)
 */
export async function assignVanityID(
  userId: string,
  vanityId: string
): Promise<void> {
  try {
    // Validate vanity ID format
    if (!/^[a-z0-9-]+$/.test(vanityId) || vanityId.length > MAX_ID_LENGTH) {
      throw new Error('Invalid vanity ID format');
    }

    // Check if vanity ID is already taken
    const existing = await prisma.tellyID.findUnique({
      where: { vanityId },
    });
    if (existing) {
      throw new Error('Vanity ID already taken');
    }

    // Update user's Telly ID record with vanity ID
    await prisma.tellyID.update({
      where: { userId },
      data: {
        vanityId,
        isPremium: true,
      },
    });
  } catch (error) {
    console.error('Failed to assign vanity ID:', error);
    throw error;
  }
}

/**
 * Get effective Telly ID (vanity if available, otherwise standard)
 */
export async function getEffectiveTellyID(userId: string): Promise<string | null> {
  try {
    const record = await prisma.tellyID.findUnique({
      where: { userId },
      select: { vanityId: true, tellyId: true },
    });
    return record?.vanityId || record?.tellyId || null;
  } catch (error) {
    console.error('Failed to fetch effective Telly ID:', error);
    return null;
  }
}
