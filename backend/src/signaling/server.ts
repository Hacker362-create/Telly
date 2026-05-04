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
  callsConnectedCounter,
  callFailuresCounter,
  callDurationHistogram,
  callSetupLatencyHistogram,
  callPacketLossHistogram,
  callLatencyHistogram,
  callDataBytesCounter,
  onlineUsersGauge,
  messagesSentCounter,
} from '../metrics/registry';
import {
  setPresence,
  clearPresence,
  PresenceStatus,
} from '../presence/PresenceStore';
import { getRedisClient } from './Gatekeeper';
import { DAILY_FREE_MINUTES, getNextResetTime, maybeResetDailyMinutes } from '../services/FreeTierService';

const prisma = new PrismaClient();

export interface CallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  roomId: string;
  startedAt: Date;
  acceptedAt?: Date;
  relayMode?: boolean;
}

interface EndCallStats {
  durationMs?: number;
  dataBytes?: number;
  avgLatencyMs?: number;
  packetLossPct?: number;
  success?: boolean;
  networkType?: string;
  iceRestartCount?: number;
  relayUsed?: boolean;
  reconnectionEvents?: number;
}

const activeCalls = new Map<string, CallSession>();
const pendingCallQueue = new Map<string, Array<{ callId: string; callerId: string; offer?: RTCSessionDescriptionInit }>>();
const userSockets = new Map<string, Set<string>>();
let signalingIo: Server | null = null;

const AIRTIME_COST_MIN = parseFloat(process.env.AIRTIME_COST_MIN ?? '3');
const AIRTIME_COST_MAX = parseFloat(process.env.AIRTIME_COST_MAX ?? '6');
const AIRTIME_COST_PER_MIN = parseFloat(
  process.env.AIRTIME_COST_PER_MIN ?? String((AIRTIME_COST_MIN + AIRTIME_COST_MAX) / 2),
);

function estimateAirtimeCost(durationMs: number): { estimatedAirtimeCost: number; estimatedSavingsKes: number } {
  const minutes = Math.max(0, durationMs) / 60000;
  const cost = Math.max(0, minutes * AIRTIME_COST_PER_MIN);
  const rounded = Math.round(cost * 100) / 100;
  return {
    estimatedAirtimeCost: rounded,
    estimatedSavingsKes: rounded,
  };
}

function addUserSocket(userId: string, socketId: string): void {
  const ids = userSockets.get(userId) ?? new Set<string>();
  ids.add(socketId);
  userSockets.set(userId, ids);
}

function removeUserSocket(userId: string, socketId: string): void {
  const ids = userSockets.get(userId);
  if (!ids) return;
  ids.delete(socketId);
  if (ids.size === 0) userSockets.delete(userId);
}

function isUserOnline(userId: string): boolean {
  return (userSockets.get(userId)?.size ?? 0) > 0;
}

const decodePayload = (payload: unknown): Record<string, unknown> => {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(payload)) {
    try {
      return JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (payload instanceof Uint8Array) {
    try {
      return JSON.parse(Buffer.from(payload).toString('utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>;
  return {};
};

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
  signalingIo = io;

  io.on('connection', (socket: Socket) => {
    const { userId, fcmToken } = socket.handshake.auth as { userId: string; fcmToken?: string };
    socket.join(`user:${userId}`);
    addUserSocket(userId, socket.id);
    console.info(`[Signaling] connected user=${userId} socket=${socket.id}`);

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

    if (socket.data.subscriptionInGrace) {
      socket.emit('subscription:grace', {
        message: 'Subscription grace period active. Renew to avoid call blocking.',
      });
    }

    if (socket.data.freeTier) {
      const freeMinutesRemaining = typeof socket.data.freeMinutesRemaining === 'number'
        ? socket.data.freeMinutesRemaining
        : DAILY_FREE_MINUTES;
      const bonusMinutes = typeof socket.data.bonusMinutesRemaining === 'number'
        ? socket.data.bonusMinutesRemaining
        : 0;
      const nextResetTime = typeof socket.data.nextResetTime === 'string'
        ? socket.data.nextResetTime
        : getNextResetTime(new Date()).toISOString();
      socket.emit('subscription:balance', {
        freeMinutesRemaining,
        dailyFreeMinutes: DAILY_FREE_MINUTES,
        dailyMinutesUsed: Math.max(0, DAILY_FREE_MINUTES - freeMinutesRemaining),
        bonusMinutes,
        nextResetTime,
      });
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

    socket.on('call:warmup', ({ calleeId }: { calleeId: string }) => {
      io.to(`user:${calleeId}`).emit('call:warmup:ping', { callerId: userId, at: Date.now() });
      socket.emit('call:warmup:ready', { calleeId, at: Date.now() });
    });

    // Initiate an outgoing call
    socket.on('call:initiate', async ({
      calleeId,
      calleeTellyId,
      callId: inboundCallId,
      offer,
    }: {
      calleeId?: string;
      calleeTellyId?: string;
      callId?: string;
      offer?: RTCSessionDescriptionInit;
    }) => {
      console.info(
        `[Signaling] call:initiate caller=${userId} calleeId=${calleeId ?? '-'} calleeTellyId=${calleeTellyId ?? '-'} callId=${inboundCallId ?? '-'}`,
      );

      let resolvedCalleeId = calleeId;
      if (!resolvedCalleeId && calleeTellyId) {
        const resolved = await prisma.tellyID.findFirst({
          where: {
            OR: [
              { tellyId: calleeTellyId },
              { vanityId: calleeTellyId },
            ],
          },
          select: { userId: true },
        }).catch(() => null);
        resolvedCalleeId = resolved?.userId;
      }

      if (!resolvedCalleeId) {
        console.warn(`[Signaling] call:initiate unresolved-callee caller=${userId} calleeTellyId=${calleeTellyId ?? '-'}`);
        socket.emit('call:unavailable', {
          callId: inboundCallId ?? `call_${Date.now()}_${userId}`,
          reason: 'user_not_found',
        });
        return;
      }

      if (resolvedCalleeId === userId) {
        socket.emit('call:unavailable', {
          callId: inboundCallId ?? `call_${Date.now()}_${userId}`,
          reason: 'cannot_call_self',
        });
        return;
      }

      const callId = inboundCallId ?? `call_${Date.now()}_${userId}`;
      const calleeBusy = Array.from(activeCalls.values()).some(
        (c) => c.calleeId === resolvedCalleeId || c.callerId === resolvedCalleeId,
      );

      const calleeOnline = isUserOnline(resolvedCalleeId);
      if (!calleeOnline) {
        console.warn(`[Signaling] call:initiate callee-offline callId=${callId} callee=${resolvedCalleeId}`);
        socket.emit('call:unavailable', { callId, reason: 'offline' });

        const caller = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        }).catch(() => null);

        sendIncomingCallPush(resolvedCalleeId, {
          callId,
          callerId: userId,
          callerName: caller?.name ?? 'Telly User',
        }).catch((err) => console.error('[Signaling] Push failed:', err));
        return;
      }

      if (calleeBusy) {
        const queue = pendingCallQueue.get(resolvedCalleeId) ?? [];
        queue.push({ callId, callerId: userId, offer });
        pendingCallQueue.set(resolvedCalleeId, queue);
        console.info(`[Signaling] call:queued callId=${callId} caller=${userId} callee=${resolvedCalleeId} queue=${queue.length}`);
        socket.emit('call:queued', { callId, etaMs: 2500 + (queue.length * 1000) });
        return;
      }

      const roomId = `room_${callId}`;
      const startedAt = new Date();
      const session: CallSession = {
        callId,
        callerId: userId,
        calleeId: resolvedCalleeId,
        roomId,
        startedAt,
      };
      activeCalls.set(callId, session);
      socket.join(roomId);
      activeCallsGauge.inc();
      callsStartedCounter.inc();

      // Persist call record so we can log duration/data when it ends
      prisma.callLog.create({
        data: { callerId: userId, calleeId: resolvedCalleeId, startedAt },
      }).catch((err) => console.error('[Signaling] CallLog create failed:', err));

      // Notify the callee if they are online
      io.to(`user:${resolvedCalleeId}`).emit('call:incoming', {
        callId,
        callerId: userId,
        offer,
      });
      console.info(`[Signaling] call:incoming delivered callId=${callId} caller=${userId} callee=${resolvedCalleeId}`);

      // Also send a push notification to wake the callee's device if offline
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }).catch(() => null);

      sendIncomingCallPush(resolvedCalleeId, {
        callId,
        callerId: userId,
        callerName: caller?.name ?? 'Telly User',
      }).catch((err) => console.error('[Signaling] Push failed:', err));
    });

    // Optional compact payload for very weak networks (binary frames)
    socket.on('call:offer:bin', ({ callId, payload }: { callId: string; payload: unknown }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      if (session.callerId !== userId) return;
      const decoded = decodePayload(payload);
      io.to(`user:${session.calleeId}`).emit('call:offer', { callId, offer: decoded.offer as RTCSessionDescriptionInit });
    });

    // Relay an SDP offer to the callee after call initiation
    socket.on('call:offer', ({ callId, offer }: { callId: string; offer: RTCSessionDescriptionInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      if (session.callerId !== userId) return;
      io.to(`user:${session.calleeId}`).emit('call:offer', { callId, offer });
    });

    // Accept an incoming call
    socket.on('call:accept', ({ callId, answer }: { callId: string; answer: RTCSessionDescriptionInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      if (session.calleeId !== userId) return;
      socket.join(session.roomId);
      session.acceptedAt = new Date();
      callsConnectedCounter.inc();
      callSetupLatencyHistogram.observe(session.acceptedAt.getTime() - session.startedAt.getTime());
      console.info(`[Signaling] call:accepted callId=${callId} caller=${session.callerId} callee=${session.calleeId}`);
      io.to(`user:${session.callerId}`).emit('call:accepted', { callId, answer });
    });

    socket.on('call:accept:bin', ({ callId, payload }: { callId: string; payload: unknown }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      if (session.calleeId !== userId) return;
      socket.join(session.roomId);
      session.acceptedAt = new Date();
      callsConnectedCounter.inc();
      callSetupLatencyHistogram.observe(session.acceptedAt.getTime() - session.startedAt.getTime());
      const decoded = decodePayload(payload);
      console.info(`[Signaling] call:accepted(bin) callId=${callId} caller=${session.callerId} callee=${session.calleeId}`);
      io.to(`user:${session.callerId}`).emit('call:accepted', { callId, answer: decoded.answer as RTCSessionDescriptionInit });
    });

    socket.on('call:reject', ({ callId, reason }: { callId: string; reason?: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      if (session.calleeId !== userId) return;

      const rejectionReason = reason ?? 'rejected';
      console.info(`[Signaling] call:rejected callId=${callId} caller=${session.callerId} callee=${session.calleeId} reason=${rejectionReason}`);
      io.to(`user:${session.callerId}`).emit('call:rejected', { callId, reason: rejectionReason });
      io.to(session.roomId).emit('call:ended', { callId, reason: rejectionReason });
      activeCalls.delete(callId);
      activeCallsGauge.dec();
      callsEndedCounter.inc();
    });

    // Relay ICE candidates for NAT traversal
    socket.on('ice:candidate', ({ callId, candidate }: { callId: string; candidate: RTCIceCandidateInit }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const targetId = session.callerId === userId ? session.calleeId : session.callerId;
      io.to(`user:${targetId}`).emit('ice:candidate', { callId, candidate });
    });

    socket.on('ice:candidate:bin', ({ callId, payload }: { callId: string; payload: unknown }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const decoded = decodePayload(payload);
      const targetId = session.callerId === userId ? session.calleeId : session.callerId;
      io.to(`user:${targetId}`).emit('ice:candidate', { callId, candidate: decoded.candidate as RTCIceCandidateInit });
    });

    socket.on('call:relay-request', ({ callId }: { callId: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      session.relayMode = true;
      io.to(session.roomId).emit('call:relay-mode', { callId, relay: true });
    });

    socket.on('call:reliability', async ({
      callId,
      latencyMs,
      packetLossPct,
      dataBytes,
      networkType,
      iceRestartCount,
      relayUsed,
      reconnectionEvents,
    }: {
      callId: string;
      latencyMs: number;
      packetLossPct: number;
      dataBytes: number;
      networkType?: string;
      iceRestartCount?: number;
      relayUsed?: boolean;
      reconnectionEvents?: number;
    }) => {
      const session = activeCalls.get(callId);
      if (!session) return;

      callLatencyHistogram.observe(Math.max(0, latencyMs));
      callPacketLossHistogram.observe(Math.max(0, packetLossPct));

      const redis = getRedisClient();
      const key = `call:reliability:${callId}`;
      await redis.setex(
        key,
        300,
        JSON.stringify({
          callId,
          latencyMs,
          packetLossPct,
          dataBytes,
          networkType: networkType ?? 'unknown',
          iceRestartCount: iceRestartCount ?? 0,
          relayUsed: Boolean(relayUsed),
          reconnectionEvents: reconnectionEvents ?? 0,
          updatedAt: Date.now(),
        }),
      );
    });

    // ICE restart for seamless network switching
    socket.on('ice:restart', ({ callId }: { callId: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const targetId = session.callerId === userId ? session.calleeId : session.callerId;
      io.to(`user:${targetId}`).emit('ice:restart', { callId });
    });

    // End a call — update the CallLog with duration
    socket.on('call:end', async ({ callId, stats }: { callId: string; stats?: EndCallStats }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      console.info(`[Signaling] call:end callId=${callId} initiator=${userId}`);

      const endedAt = new Date();
      const durationMs = stats?.durationMs ?? (endedAt.getTime() - session.startedAt.getTime());
      const dataBytes = Math.max(0, Math.round(stats?.dataBytes ?? 0));
      const packetLossPct = Math.max(0, stats?.packetLossPct ?? 0);
      const avgLatencyMs = Math.max(0, stats?.avgLatencyMs ?? 0);
      const success = stats?.success ?? durationMs >= 5000;
      const { estimatedAirtimeCost, estimatedSavingsKes } = estimateAirtimeCost(durationMs);

      io.to(session.roomId).emit('call:ended', { callId, durationMs });
      activeCalls.delete(callId);
      activeCallsGauge.dec();
      callsEndedCounter.inc();
      callDurationHistogram.observe(durationMs);
      callDataBytesCounter.inc(dataBytes);
      callPacketLossHistogram.observe(packetLossPct);
      callLatencyHistogram.observe(avgLatencyMs);

      if (!success) {
        callFailuresCounter.inc();
      }

      prisma.callLog.updateMany({
        where: { callerId: session.callerId, calleeId: session.calleeId, endedAt: null },
        data: {
          endedAt,
          durationMs,
          dataBytes,
          recordingUrl: stats?.relayUsed ? 'relay:turn' : undefined,
          estimatedAirtimeCost,
          estimatedSavingsKes,
        },
      }).catch((err) => console.error('[Signaling] CallLog update failed:', err));

      (prisma as unknown as {
        callAnalytics: { upsert: (args: unknown) => Promise<unknown> }
      }).callAnalytics.upsert({
        where: { callId },
        update: {
          endedAt,
          durationMs,
          dataBytes,
          avgLatencyMs,
          packetLossPct,
          networkType: stats?.networkType ?? 'unknown',
          iceRestartCount: stats?.iceRestartCount ?? 0,
          relayUsed: Boolean(stats?.relayUsed || session.relayMode),
          reconnectionEvents: stats?.reconnectionEvents ?? 0,
          success,
        },
        create: {
          callId,
          callerId: session.callerId,
          calleeId: session.calleeId,
          startedAt: session.startedAt,
          endedAt,
          durationMs,
          dataBytes,
          avgLatencyMs,
          packetLossPct,
          networkType: stats?.networkType ?? 'unknown',
          iceRestartCount: stats?.iceRestartCount ?? 0,
          relayUsed: Boolean(stats?.relayUsed || session.relayMode),
          reconnectionEvents: stats?.reconnectionEvents ?? 0,
          success,
        },
      }).catch((err: unknown) => console.error('[Signaling] Call analytics upsert failed:', err));

      const redis = getRedisClient();
      redis.setex(
        `call:analytics:${callId}`,
        604800,
        JSON.stringify({
          callId,
          callerId: session.callerId,
          calleeId: session.calleeId,
          networkType: stats?.networkType ?? 'unknown',
          iceRestartCount: stats?.iceRestartCount ?? 0,
          relayUsed: Boolean(stats?.relayUsed || session.relayMode),
          reconnectionEvents: stats?.reconnectionEvents ?? 0,
          packetLossPct,
          avgLatencyMs,
          dataBytes,
          success,
          endedAt: endedAt.toISOString(),
        }),
      ).catch(() => undefined);

      // Deduct daily free-tier minutes for both caller and callee if unsubscribed
      const durationMinutes = Math.ceil(durationMs / 60000);
      if (durationMinutes > 0) {
        const deductFreeTierMinutes = async (targetUserId: string): Promise<void> => {
          const now = new Date();
          await maybeResetDailyMinutes(prisma, targetUserId, now);
          const user = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: {
              isActive: true,
              subscriptionExpiry: true,
              dailyMinutesUsed: true,
              bonusMinutes: true,
            },
          });
          if (!user) return;

          const isSubscribed = user.isActive && user.subscriptionExpiry > now;
          if (isSubscribed) return; // subscribed users are not on the free tier

          const currentUsed = user.dailyMinutesUsed ?? 0;
          const currentBonus = user.bonusMinutes ?? 0;
          const dailyFreeMinutes = DAILY_FREE_MINUTES;
          const dailyRemaining = Math.max(0, dailyFreeMinutes - currentUsed);
          const dailyConsumed = Math.min(dailyRemaining, durationMinutes);
          const remainingAfterDaily = Math.max(0, durationMinutes - dailyConsumed);
          const bonusConsumed = Math.min(currentBonus, remainingAfterDaily);
          const newUsed = Math.min(dailyFreeMinutes, currentUsed + dailyConsumed);
          const newBonus = Math.max(0, currentBonus - bonusConsumed);
          const freeMinutesRemaining = Math.max(0, dailyFreeMinutes - newUsed);

          await prisma.user.update({
            where: { id: targetUserId },
            data: {
              dailyMinutesUsed: newUsed,
              bonusMinutes: newBonus,
            },
          });

          // Emit balance update to the user
          io.to(`user:${targetUserId}`).emit('subscription:balance', {
            freeMinutesRemaining,
            dailyFreeMinutes,
            dailyMinutesUsed: newUsed,
            bonusMinutes: newBonus,
            nextResetTime: getNextResetTime(now).toISOString(),
          });
        };

        deductFreeTierMinutes(session.callerId).catch((err) =>
          console.error('[Signaling] Free tier deduction failed for caller:', err),
        );
        deductFreeTierMinutes(session.calleeId).catch((err) =>
          console.error('[Signaling] Free tier deduction failed for callee:', err),
        );
      }

      const nextQueued = pendingCallQueue.get(session.calleeId)?.shift();
      if (nextQueued) {
        io.to(`user:${nextQueued.callerId}`).emit('call:queue-ready', { callId: nextQueued.callId });
      }
    });

    // Real-time message delivery
    // The client may send a message via the socket so the recipient receives it
    // instantly without polling. The message is persisted to the DB via Prisma
    // and then forwarded to the recipient's socket room (if they are online).
    socket.on(
      'message:send',
      async ({ recipientId, body }: { recipientId: string; body: string }) => {
        if (!recipientId || typeof body !== 'string' || body.trim().length === 0) return;
        if (recipientId === userId) return; // no self-messaging

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const message = await (prisma.message as any).create({
            data: { senderId: userId, recipientId, body: body.trim() },
            select: { id: true, senderId: true, recipientId: true, body: true, sentAt: true },
          });
          messagesSentCounter.inc();

          // Deliver to the recipient's socket room (online users get it instantly)
          io.to(`user:${recipientId}`).emit('message:new', message);

          // Echo back to the sender so they can update their local UI
          socket.emit('message:sent', message);
        } catch (err) {
          console.error('[Signaling] message:send failed:', err);
        }
      },
    );

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
      removeUserSocket(userId, socket.id);
      console.info(`[Signaling] disconnected user=${userId} socket=${socket.id}`);
      clearPresence(userId).catch((err) =>
        console.error('[Signaling] Failed to clear presence:', err),
      );
      onlineUsersGauge.dec();
      io.emit('presence:changed', { userId, status: 'offline' });
    });
  });

  return io;
}

export function terminateActiveCall(callId: string, reason = 'terminated'): boolean {
  const session = activeCalls.get(callId);
  if (!session) return false;

  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - session.startedAt.getTime());
  const { estimatedAirtimeCost, estimatedSavingsKes } = estimateAirtimeCost(durationMs);
  signalingIo?.to(session.roomId).emit('call:ended', { callId, durationMs, reason });

  activeCalls.delete(callId);
  activeCallsGauge.dec();
  callsEndedCounter.inc();
  callDurationHistogram.observe(durationMs);

  prisma.callLog.updateMany({
    where: { callerId: session.callerId, calleeId: session.calleeId, endedAt: null },
    data: { endedAt, durationMs, estimatedAirtimeCost, estimatedSavingsKes },
  }).catch(() => undefined);

  return true;
}

export { activeCalls };
