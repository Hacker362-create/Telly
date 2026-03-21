import { Router, Response, Request } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  createTellyID,
  getTellyID,
  resolveTellyIDToUserId,
  getEffectiveTellyID,
  assignVanityID,
} from '../services/TellyIDService';
import {
  saveContact,
  getContacts,
  searchContacts,
  toggleFavoriteContact,
  updateContact,
  deleteContact,
  getContactByTellyID,
} from '../services/ContactService';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /telly-id/create
 * Auto-generate and create Telly ID for new user (called during signup)
 */
router.post('/create', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user already has a Telly ID
    const existingTellyID = await getTellyID(userId);
    if (existingTellyID) {
      return res.status(200).json({
        tellyId: existingTellyID,
        message: 'Telly ID already exists',
      });
    }

    const tellyId = await createTellyID(userId, user.email);

    res.status(201).json({
      tellyId,
      message: 'Telly ID created successfully',
    });
  } catch (error) {
    console.error('Error creating Telly ID:', error);
    res.status(500).json({ error: 'Failed to create Telly ID' });
  }
});

/**
 * GET /telly-id
 * Get current user's Telly ID
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let tellyId = await getEffectiveTellyID(userId);
    if (!tellyId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user?.email) {
        return res.status(404).json({ error: 'User not found' });
      }

      tellyId = await createTellyID(userId, user.email);
    }

    res.status(200).json({ tellyId });
  } catch (error) {
    console.error('Error fetching Telly ID:', error);
    res.status(500).json({ error: 'Failed to fetch Telly ID' });
  }
});

/**
 * GET /telly-id/lookup/:tellyId
 * Lookup a Telly ID to get user info (public endpoint)
 */
router.get('/lookup/:tellyId', async (req: Request, res: Response) => {
  try {
    const { tellyId } = req.params;

    const userId = await resolveTellyIDToUserId(tellyId);
    if (!userId) {
      return res.status(404).json({ error: 'Telly ID not found' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        isActive: true,
        subscriptionExpiry: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      userId: user.id,
      name: user.name,
      isActive: user.isActive,
      isSubscriptionValid: new Date(user.subscriptionExpiry) > new Date(),
    });
  } catch (error) {
    console.error('Error looking up Telly ID:', error);
    res.status(500).json({ error: 'Failed to lookup Telly ID' });
  }
});

/**
 * POST /contacts
 * Save a contact with Telly ID
 */
router.post('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tellyId, displayName, notes } = req.body;

    if (!tellyId || typeof tellyId !== 'string') {
      return res.status(400).json({ error: 'Invalid Telly ID' });
    }

    const contact = await saveContact(
      userId,
      tellyId,
      displayName,
      notes
    );

    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Error saving contact:', error);
    res.status(500).json({ error: error.message || 'Failed to save contact' });
  }
});

/**
 * GET /contacts
 * Get all contacts for current user
 */
router.get('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const favoriteOnly = req.query.favoriteOnly === 'true';

    const contacts = await getContacts(userId, { limit, offset, favoriteOnly });

    res.status(200).json({ contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

/**
 * GET /contacts/search
 * Search contacts by Telly ID or display name
 */
router.get('/contacts/search', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Missing search query' });
    }

    const contacts = await searchContacts(userId, q);

    res.status(200).json({ contacts });
  } catch (error) {
    console.error('Error searching contacts:', error);
    res.status(500).json({ error: 'Failed to search contacts' });
  }
});

/**
 * GET /contacts/:contactId
 * Get a specific contact
 */
router.get('/contacts/:contactId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { contactId } = req.params;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.ownerId !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.status(200).json({
      id: contact.id,
      tellyId: contact.tellyId,
      displayName: contact.displayName,
      notes: contact.notes,
      isFavorite: contact.isFavorite,
      createdAt: contact.createdAt,
    });
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

/**
 * PATCH /contacts/:contactId
 * Update contact details
 */
router.patch('/contacts/:contactId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { contactId } = req.params;
    const { displayName, notes } = req.body;

    const contact = await updateContact(userId, contactId, displayName, notes);

    res.status(200).json(contact);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: error.message || 'Failed to update contact' });
  }
});

/**
 * PATCH /contacts/:contactId/favorite
 * Toggle favorite status for a contact
 */
router.patch(
  '/contacts/:contactId/favorite',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { contactId } = req.params;

      const contact = await toggleFavoriteContact(userId, contactId);

      res.status(200).json(contact);
    } catch (error: any) {
      console.error('Error toggling favorite:', error);
      res.status(500).json({ error: error.message || 'Failed to toggle favorite' });
    }
  }
);

/**
 * DELETE /contacts/:contactId
 * Delete a contact
 */
router.delete('/contacts/:contactId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { contactId } = req.params;

    await deleteContact(userId, contactId);

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: error.message || 'Failed to delete contact' });
  }
});

/**
 * POST /admin/vanity-id
 * Assign vanity ID to user (admin only)
 */
router.post('/admin/vanity-id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetUserId, vanityId } = req.body;

    if (!targetUserId || !vanityId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await assignVanityID(targetUserId, vanityId);

    const updatedTellyId = await getEffectiveTellyID(targetUserId);

    res.status(200).json({
      tellyId: updatedTellyId,
      message: 'Vanity ID assigned successfully',
    });
  } catch (error: any) {
    console.error('Error assigning vanity ID:', error);
    res.status(500).json({ error: error.message || 'Failed to assign vanity ID' });
  }
});

export default router;
