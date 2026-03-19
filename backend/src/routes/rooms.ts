// src/routes/rooms.ts
// Multi-party room management for Telly group calls.
// A Room maps a named "room" to a shared Mediasoup Router and keeps track
// of which participants have joined. Up to MAX_ROOM_PARTICIPANTS are allowed
// per room to bound SFU memory usage.
//
// Typical flow for a 3-person call:
//   1. One participant calls POST /media/rooms → gets roomId + transport params
//   2. They share the roomId out-of-band (e.g. via a group chat link)
//   3. Others call POST /media/rooms/:id/join → each gets their own transport
//   4. Every participant POSTs to /media/transports/:transportId/produce
//      and /media/transports/:transportId/consume for each remote producer

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getOrCreateRouter, createWebRtcTransport } from '../media/Worker';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';
import { liveTransports } from './media';
import { activeRoomsGauge } from '../metrics/registry';
import type { Router as MediasoupRouter, WebRtcTransport } from 'mediasoup/node/lib/types';

const router = Router();

const MAX_ROOM_PARTICIPANTS = 8;

export interface Room {
  id: string;
  creatorId: string;
  createdAt: Date;
  routerId: string;
  participantIds: Set<string>;
  transports: Map<string, WebRtcTransport>;
}

// In-memory room registry.  In a multi-replica deployment, this should live
// in Redis; for a single-node MVP an in-process Map is sufficient.
export const activeRooms = new Map<string, Room>();

// ── POST /media/rooms ──────────────────────────────────────────────────────────
// Create a new multi-party room. The creator is automatically the first participant.
router.post(
  '/',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;

    const sfuRouter: MediasoupRouter = await getOrCreateRouter();
    const { transport, params } = await createWebRtcTransport();
    liveTransports.set(transport.id, transport);
    transport.on('routerclose', () => {
      liveTransports.delete(transport.id);
    });

    const roomId = uuidv4();
    const room: Room = {
      id: roomId,
      creatorId: userId,
      createdAt: new Date(),
      routerId: sfuRouter.id,
      participantIds: new Set([userId]),
      transports: new Map([[transport.id, transport]]),
    };
    activeRooms.set(roomId, room);
    activeRoomsGauge.inc();

    // Auto-clean the room when the transport closes (creator left)
    transport.on('routerclose', () => {
      activeRooms.delete(roomId);
      activeRoomsGauge.dec();
    });

    res.status(201).json({
      roomId,
      participantCount: room.participantIds.size,
      transport: params,
      rtpCapabilities: sfuRouter.rtpCapabilities,
    });
  },
);

// ── GET /media/rooms/:id ───────────────────────────────────────────────────────
// Retrieve room metadata (participant count, RTP capabilities).
router.get(
  '/:id',
  apiLimiter,
  requireAuth,
  (req: AuthRequest, res: Response): void => {
    const room = activeRooms.get(req.params.id);
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    const sfuRouter = getOrCreateRouter as unknown as { _cachedRouter?: MediasoupRouter };
    res.json({
      roomId: room.id,
      creatorId: room.creatorId,
      participantCount: room.participantIds.size,
      createdAt: room.createdAt,
    });
  },
);

// ── POST /media/rooms/:id/join ─────────────────────────────────────────────────
// Join an existing room. Creates a new per-participant transport and registers
// the caller as a participant.
router.post(
  '/:id/join',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.userId as string;
    const room = activeRooms.get(req.params.id);

    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    if (room.participantIds.size >= MAX_ROOM_PARTICIPANTS) {
      res.status(409).json({ error: `Room is full (max ${MAX_ROOM_PARTICIPANTS} participants)` });
      return;
    }

    const sfuRouter: MediasoupRouter = await getOrCreateRouter();
    const { transport, params } = await createWebRtcTransport();
    liveTransports.set(transport.id, transport);
    transport.on('routerclose', () => liveTransports.delete(transport.id));

    room.participantIds.add(userId);
    room.transports.set(transport.id, transport);

    res.status(201).json({
      roomId: room.id,
      participantCount: room.participantIds.size,
      transport: params,
      rtpCapabilities: sfuRouter.rtpCapabilities,
    });
  },
);

// ── DELETE /media/rooms/:id/leave ──────────────────────────────────────────────
// Leave a room. When the last participant leaves the room is deleted.
router.delete(
  '/:id/leave',
  apiLimiter,
  requireAuth,
  (req: AuthRequest, res: Response): void => {
    const userId = req.userId as string;
    const room = activeRooms.get(req.params.id);

    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    room.participantIds.delete(userId);

    if (room.participantIds.size === 0) {
      // Close all transports and delete the room
      room.transports.forEach((t) => t.close());
      activeRooms.delete(room.id);
      activeRoomsGauge.dec();
    }

    res.json({ roomId: room.id, participantCount: room.participantIds.size });
  },
);

export default router;
