// src/signaling/server.ts
// Socket.io signaling server for Telly VoIP platform.
// Handles call routing, ICE candidate exchange, and presence management.

import { Server, Socket } from 'socket.io';
import * as http from 'http';
import { gatekeeperMiddleware } from './Gatekeeper';

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
    const { userId } = socket.handshake.auth as { userId: string };
    socket.join(`user:${userId}`);

    // Initiate an outgoing call
    socket.on('call:initiate', ({ calleeId, offer }: { calleeId: string; offer: RTCSessionDescriptionInit }) => {
      const callId = `call_${Date.now()}_${userId}`;
      const roomId = `room_${callId}`;
      const session: CallSession = {
        callId,
        callerId: userId,
        calleeId,
        roomId,
        startedAt: new Date(),
      };
      activeCalls.set(callId, session);
      socket.join(roomId);

      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId,
        callerId: userId,
        offer,
      });
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

    // End a call
    socket.on('call:end', ({ callId }: { callId: string }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      io.to(session.roomId).emit('call:ended', { callId });
      activeCalls.delete(callId);
    });

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
    });
  });

  return io;
}

export { activeCalls };
