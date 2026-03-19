// src/signaling/server.ts
// Socket.io signaling server for Telly VoIP platform.
// Handles call routing, ICE candidate exchange, presence management,
// call logging, and push notifications for background wake-up.

import { Server, Socket } from 'socket.io';
import * as http from 'http';
import { PrismaClient } from '@prisma/client';
import { gatekeeperMiddleware } from './Gatekeeper';
import { sendIncomingCallPush, storeDeviceToken } from '../notifications/push';

const prisma = new PrismaClient();

export interface CallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  roomId: string;
  startedAt: Date;
}

const activeCalls = new Map<string, CallSession>();

export function createSignalingServer(httpServer: http.Server): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['*'],
      methods: ['GET', 'POST'],
    },
    // Use binary transport for minimal payload overhead
    serveClient: false,
    pingTimeout: 10000,
    pingInterval: 5000,
  });

  // Apply subscription gatekeeper to all connections
  io.use(gatekeeperMiddleware);

  io.on('connection', (socket: Socket) => {
    const { userId, fcmToken } = socket.handshake.auth as { userId: string; fcmToken?: string };
    socket.join(`user:${userId}`);

    // Persist the device push token so we can wake the device for incoming calls
    if (fcmToken) {
      storeDeviceToken(userId, fcmToken).catch((err) =>
        console.error('[Signaling] Failed to store FCM token:', err),
      );
    }

    // Initiate an outgoing call
    socket.on('call:initiate', async ({ calleeId, offer }: { calleeId: string; offer: RTCSessionDescriptionInit }) => {
      const callId = `call_${Date.now()}_${userId}`;
      const roomId = `room_${callId}`;
      const startedAt = new Date();
      const session: CallSession = {
        callId,
        callerId: userId,
        calleeId,
        roomId,
        startedAt,
      };
      activeCalls.set(callId, session);
      socket.join(roomId);

      // Persist call record so we can log duration/data when it ends
      prisma.callLog.create({
        data: { callerId: userId, calleeId, startedAt },
      }).catch((err) => console.error('[Signaling] CallLog create failed:', err));

      // Notify the callee if they are online
      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId,
        callerId: userId,
        offer,
      });

      // Also send a push notification to wake the callee's device if offline
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }).catch(() => null);

      sendIncomingCallPush(calleeId, {
        callId,
        callerId: userId,
        callerName: caller?.name ?? 'Telly User',
      }).catch((err) => console.error('[Signaling] Push failed:', err));
    });

    // Relay an SDP offer to the callee after call initiation
    socket.on('call:offer', ({ callId, offer }: { callId: string; offer: RTCSessionDescriptionInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      io.to(`user:${session.calleeId}`).emit('call:offer', { callId, offer });
    });

    // Accept an incoming call
    socket.on('call:accept', ({ callId, answer }: { callId: string; answer: RTCSessionDescriptionInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      socket.join(session.roomId);
      io.to(`user:${session.callerId}`).emit('call:accepted', { callId, answer });
    });

    // Relay ICE candidates for NAT traversal
    socket.on('ice:candidate', ({ callId, candidate }: { callId: string; candidate: RTCIceCandidateInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const targetId = session.callerId === userId ? session.calleeId : session.callerId;
      io.to(`user:${targetId}`).emit('ice:candidate', { callId, candidate });
    });

    // ICE restart for seamless network switching
    socket.on('ice:restart', ({ callId }: { callId: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const targetId = session.callerId === userId ? session.calleeId : session.callerId;
      io.to(`user:${targetId}`).emit('ice:restart', { callId });
    });

    // End a call — update the CallLog with duration
    socket.on('call:end', ({ callId }: { callId: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;

      const endedAt = new Date();
      const durationMs = endedAt.getTime() - session.startedAt.getTime();

      io.to(session.roomId).emit('call:ended', { callId, durationMs });
      activeCalls.delete(callId);

      prisma.callLog.updateMany({
        where: { callerId: session.callerId, calleeId: session.calleeId, endedAt: null },
        data: { endedAt, durationMs },
      }).catch((err) => console.error('[Signaling] CallLog update failed:', err));
    });

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
    });
  });

  return io;
}

export { activeCalls };
