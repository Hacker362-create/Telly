// src/signaling/server.ts
// Socket.io signaling server for Telly VoIP platform.
// Handles call routing, ICE candidate exchange, presence management,
// call logging, and push notifications for background wake-up.

import { Server, Socket } from 'socket.io';
import * as http from 'http';
import { PrismaClient } from '@prisma/client';

// WebRTC payload shapes relayed over Socket.io (browser types not in Node lib)
type RTCSessionDescriptionInit = { type: string; sdp?: string };
type RTCIceCandidateInit = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
import { gatekeeperMiddleware } from './Gatekeeper';
import { sendIncomingCallPush, storeDeviceToken } from '../notifications/push';
import {
  activeCallsGauge,
  callsStartedCounter,
  callsEndedCounter,
  callDurationHistogram,
  onlineUsersGauge,
} from '../metrics/registry';
import {
  setPresence,
  clearPresence,
  PresenceStatus,
} from '../presence/PresenceStore';

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

    // Mark user as online and update the gauge
    setPresence(userId, 'online').catch((err) =>
      console.error('[Signaling] Failed to set presence:', err),
    );
    onlineUsersGauge.inc();

    // Broadcast presence change to all connected peers (they can subscribe to
    // 'presence:changed' to update contact-list avatars in real time)
    io.emit('presence:changed', { userId, status: 'online' });

    // Persist the device push token so we can wake the device for incoming calls
    if (fcmToken) {
      storeDeviceToken(userId, fcmToken).catch((err) =>
        console.error('[Signaling] Failed to store FCM token:', err),
      );
    }

    // Allow the client to update its own status (busy, away, online)
    socket.on('presence:set', ({ status }: { status: PresenceStatus }) => {
      const allowed: PresenceStatus[] = ['online', 'busy', 'away'];
      if (!allowed.includes(status)) return;
      setPresence(userId, status).catch((err) =>
        console.error('[Signaling] Failed to update presence:', err),
      );
      io.emit('presence:changed', { userId, status });
    });

    // Heartbeat: refresh Redis TTL so the record doesn't expire while connected
    socket.on('presence:heartbeat', () => {
      setPresence(userId, 'online').catch((err) =>
        console.error('[Signaling] Failed to refresh presence heartbeat:', err),
      );
    });

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
      activeCallsGauge.inc();
      callsStartedCounter.inc();

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
      activeCallsGauge.dec();
      callsEndedCounter.inc();
      callDurationHistogram.observe(durationMs);

      prisma.callLog.updateMany({
        where: { callerId: session.callerId, calleeId: session.calleeId, endedAt: null },
        data: { endedAt, durationMs },
      }).catch((err) => console.error('[Signaling] CallLog update failed:', err));
    });

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
      clearPresence(userId).catch((err) =>
        console.error('[Signaling] Failed to clear presence:', err),
      );
      onlineUsersGauge.dec();
      io.emit('presence:changed', { userId, status: 'offline' });
    });
  });

  return io;
}

export { activeCalls };
