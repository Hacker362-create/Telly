import { PrismaClient } from '@prisma/client';
import { resolveTellyIDToUserId } from './TellyIDService';

const prisma = new PrismaClient();

interface ContactData {
  tellyId: string;
  displayName?: string;
  notes?: string;
}

interface ContactResponse {
  id: string;
  tellyId: string;
  displayName: string | null;
  notes: string | null;
  isFavorite: boolean;
  createdAt: Date;
}

/**
 * Save a Telly ID as a contact
 */
export async function saveContact(
  ownerId: string,
  contactTellyId: string,
  displayName?: string,
  notes?: string
): Promise<ContactResponse> {
  try {
    // Resolve Telly ID to user ID
    const contactUserId = await resolveTellyIDToUserId(contactTellyId);
    if (!contactUserId) {
      throw new Error(`Telly ID not found: ${contactTellyId}`);
    }

    // Prevent adding self as contact
    if (ownerId === contactUserId) {
      throw new Error('Cannot add yourself as a contact');
    }

    // Upsert contact (update if exists, create if not)
    const contact = await prisma.contact.upsert({
      where: {
        ownerId_contactUserId: {
          ownerId,
          contactUserId,
        },
      },
      update: {
        displayName: displayName || undefined,
        notes: notes || undefined,
      },
      create: {
        ownerId,
        contactUserId,
        tellyId: contactTellyId,
        displayName,
        notes,
      },
    });

    return {
      id: contact.id,
      tellyId: contact.tellyId,
      displayName: contact.displayName,
      notes: contact.notes,
      isFavorite: contact.isFavorite,
      createdAt: contact.createdAt,
    };
  } catch (error) {
    console.error('Failed to save contact:', error);
    throw error;
  }
}

/**
 * Get all contacts for a user
 */
export async function getContacts(
  ownerId: string,
  options: {
    limit?: number;
    offset?: number;
    favoriteOnly?: boolean;
  } = {}
): Promise<ContactResponse[]> {
  try {
    const { limit = 50, offset = 0, favoriteOnly = false } = options;

    const contacts = await prisma.contact.findMany({
      where: {
        ownerId,
        ...(favoriteOnly && { isFavorite: true }),
      },
      select: {
        id: true,
        tellyId: true,
        displayName: true,
        notes: true,
        isFavorite: true,
        createdAt: true,
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });

    return contacts;
  } catch (error) {
    console.error('Failed to fetch contacts:', error);
    throw error;
  }
}

/**
 * Search contacts by Telly ID or display name
 */
export async function searchContacts(
  ownerId: string,
  query: string
): Promise<ContactResponse[]> {
  try {
    const lowerQuery = query.toLowerCase();
    const contacts = await prisma.contact.findMany({
      where: {
        ownerId,
        OR: [
          { tellyId: { contains: lowerQuery } },
          { displayName: { contains: lowerQuery } },
        ],
      },
      select: {
        id: true,
        tellyId: true,
        displayName: true,
        notes: true,
        isFavorite: true,
        createdAt: true,
      },
      take: 20,
    });

    return contacts;
  } catch (error) {
    console.error('Failed to search contacts:', error);
    throw error;
  }
}

/**
 * Toggle favorite status for a contact
 */
export async function toggleFavoriteContact(
  ownerId: string,
  contactId: string
): Promise<ContactResponse> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.ownerId !== ownerId) {
      throw new Error('Contact not found');
    }

    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: {
        isFavorite: !contact.isFavorite,
      },
    });

    return {
      id: updated.id,
      tellyId: updated.tellyId,
      displayName: updated.displayName,
      notes: updated.notes,
      isFavorite: updated.isFavorite,
      createdAt: updated.createdAt,
    };
  } catch (error) {
    console.error('Failed to toggle favorite:', error);
    throw error;
  }
}

/**
 * Update contact display name and notes
 */
export async function updateContact(
  ownerId: string,
  contactId: string,
  displayName?: string,
  notes?: string
): Promise<ContactResponse> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.ownerId !== ownerId) {
      throw new Error('Contact not found');
    }

    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(notes !== undefined && { notes }),
      },
    });

    return {
      id: updated.id,
      tellyId: updated.tellyId,
      displayName: updated.displayName,
      notes: updated.notes,
      isFavorite: updated.isFavorite,
      createdAt: updated.createdAt,
    };
  } catch (error) {
    console.error('Failed to update contact:', error);
    throw error;
  }
}

/**
 * Delete a contact
 */
export async function deleteContact(
  ownerId: string,
  contactId: string
): Promise<void> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.ownerId !== ownerId) {
      throw new Error('Contact not found');
    }

    await prisma.contact.delete({
      where: { id: contactId },
    });
  } catch (error) {
    console.error('Failed to delete contact:', error);
    throw error;
  }
}

/**
 * Check if Telly ID is in user's contacts
 */
export async function isInContacts(
  ownerId: string,
  tellyId: string
): Promise<boolean> {
  try {
    const contact = await prisma.contact.findFirst({
      where: {
        ownerId,
        tellyId,
      },
      select: { id: true },
    });
    return !!contact;
  } catch (error) {
    console.error('Failed to check contact:', error);
    return false;
  }
}

/**
 * Get contact by Telly ID
 */
export async function getContactByTellyID(
  ownerId: string,
  tellyId: string
): Promise<ContactResponse | null> {
  try {
    const contact = await prisma.contact.findFirst({
      where: {
        ownerId,
        tellyId,
      },
    });

    if (!contact) return null;

    return {
      id: contact.id,
      tellyId: contact.tellyId,
      displayName: contact.displayName,
      notes: contact.notes,
      isFavorite: contact.isFavorite,
      createdAt: contact.createdAt,
    };
  } catch (error) {
    console.error('Failed to get contact:', error);
    return null;
  }
}
