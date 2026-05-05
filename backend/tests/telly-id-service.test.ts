// tests/telly-id-service.test.ts
// Service-level tests for ID generation logic

import { PrismaClient } from '@prisma/client';
import {
  extractUsernameFromEmail,
  generateRandomSuffix,
  generateFallbackID,
  formatTellyID,
  generateUniqueTellyID,
} from '../src/services/TellyIDService';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const existingIds = new Set<string>();

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      tellyID: {
        findUnique: jest.fn(async ({ where }: { where: { tellyId?: string } }) => {
          if (!where.tellyId) return null;
          return existingIds.has(where.tellyId) ? { tellyId: where.tellyId } : null;
        }),
        create: jest.fn(async ({ data }: { data: { tellyId: string; [key: string]: unknown } }) => {
          existingIds.add(data.tellyId);
          return { ...data, id: `telly-${Date.now()}`, createdAt: new Date() };
        }),
      },
    })),
  };
});

describe('TellyIDService - Email extraction', () => {
  it('extracts username from email', () => {
    const email = 'john.smith@example.com';
    const result = extractUsernameFromEmail(email);
    expect(result).toBe('johnsmith');
  });

  it('handles lowercase conversion', () => {
    const email = 'John.Smith@EXAMPLE.COM';
    const result = extractUsernameFromEmail(email);
    expect(result).toBe('johnsmith');
  });

  it('removes non-alphanumeric characters', () => {
    const email = 'john+tag@example.com';
    const result = extractUsernameFromEmail(email);
    expect(result).toBe('johntag');
  });

  it('limits username to 10 characters', () => {
    const email = 'verylongname@example.com';
    const result = extractUsernameFromEmail(email);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('handles single character email', () => {
    const email = 'a@example.com';
    const result = extractUsernameFromEmail(email);
    expect(result).toBe('a');
  });

  it('handles email with numbers', () => {
    const email = 'john123@example.com';
    const result = extractUsernameFromEmail(email);
    expect(result).toBe('john123');
  });
});

describe('TellyIDService - Random suffix generation', () => {
  it('generates number between 0 and 99', () => {
    for (let i = 0; i < 100; i++) {
      const suffix = generateRandomSuffix();
      expect(suffix).toBeGreaterThanOrEqual(0);
      expect(suffix).toBeLessThan(100);
    }
  });

  it('generates different numbers', () => {
    const suffixes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      suffixes.add(generateRandomSuffix());
    }
    expect(suffixes.size).toBeGreaterThan(1);
  });
});

describe('TellyIDService - Fallback ID generation', () => {
  it('generates format like adjective-noun-number', () => {
    const result = generateFallbackID();
    const parts = result.baseUsername.split('-');
    expect(parts.length).toBe(2);
    expect(typeof result.suffix).toBe('number');
  });

  it('generates ID with max length constraint', () => {
    for (let i = 0; i < 20; i++) {
      const result = generateFallbackID();
      const full = `${result.baseUsername}-${result.suffix}`;
      expect(full.length).toBeLessThanOrEqual(16);
    }
  });

  it('contains only alphanumeric and hyphens', () => {
    for (let i = 0; i < 20; i++) {
      const result = generateFallbackID();
      const full = `${result.baseUsername}-${result.suffix}`;
      expect(/^[a-z0-9-]+$/.test(full)).toBe(true);
    }
  });
});

describe('TellyIDService - Format validation', () => {
  it('formats valid ID string', () => {
    const result = formatTellyID('johndoe', 42);
    expect(result).toBe('johndoe-42');
  });

  it('enforces max length of 16', () => {
    const longBase = 'veryverylongname';
    expect(() => formatTellyID(longBase, 99)).toThrow();
  });

  it('accepts lowercase format', () => {
    const result = formatTellyID('johndoe', 42);
    expect(result).toBe('johndoe-42');
  });

  it('rejects non-alphanumeric characters', () => {
    expect(() => formatTellyID('john@doe', 42)).toThrow();
  });
});

describe('TellyIDService - Unique ID generation', () => {
  it('generates unique ID on first attempt', async () => {
    const id = await generateUniqueTellyID('john.doe@example.com');
    expect(id).toBeTruthy();
    expect(/^[a-z0-9-]+$/.test(id)).toBe(true);
  });

  it('generates different IDs for different emails', async () => {
    const id1 = await generateUniqueTellyID('john@example.com');
    const id2 = await generateUniqueTellyID('jane@example.com');
    expect(id1).not.toBe(id2);
  });

  it('has max length of 16 characters', async () => {
    for (let i = 0; i < 10; i++) {
      const id = await generateUniqueTellyID(`user${i}@example.com`);
      expect(id.length).toBeLessThanOrEqual(16);
    }
  });

  it('contains only alphanumeric and hyphens', async () => {
    for (let i = 0; i < 10; i++) {
      const id = await generateUniqueTellyID(`user${i}@example.com`);
      expect(/^[a-z0-9-]+$/.test(id)).toBe(true);
    }
  });

  it('extracts username from email format', async () => {
    const id = await generateUniqueTellyID('smithjohn@example.com');
    expect(id.toLowerCase().startsWith('smith')).toBe(true);
  });
});

describe('TellyIDService - Edge cases', () => {
  it('handles email with special characters', async () => {
    const id = await generateUniqueTellyID('john+tag.smith@example.com');
    expect(id).toBeTruthy();
  });

  it('handles very short email username', async () => {
    const id = await generateUniqueTellyID('j@example.com');
    expect(id).toBeTruthy();
  });

  it('handles numeric email', async () => {
    const id = await generateUniqueTellyID('123456@example.com');
    expect(id).toBeTruthy();
  });

  it('generates from fallback when email extraction is insufficient', async () => {
    // Email with special chars that result in empty extraction
    const id = await generateUniqueTellyID('___@example.com');
    expect(id).toBeTruthy();
    expect(id.split('-').length).toBe(3); // Fallback has adjective-noun-number split
  });
});
