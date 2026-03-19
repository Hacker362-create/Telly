// mobile/src/services/SignalingService.ts
// WebSocket signaling client using Socket.io for call management.

import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.SIGNALING_URL ?? 'https://api.telly.co.ke';

type IncomingCallHandler = (callId: string, callerId: string) => void;
type CallAcceptedHandler = (callId: string) => void;
type CallEndedHandler = (callId: string) => void;

class SignalingService {
  private socket: Socket | null = null;
  private incomingCallHandlers: IncomingCallHandler[] = [];
  private callAcceptedHandlers = new Map<string, CallAcceptedHandler>();
  private callEndedHandlers = new Map<string, CallEndedHandler>();

  connect(userId: string, token: string): void {
    this.socket = io(SIGNALING_URL, {
      auth: { userId, token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    this.socket.on('call:incoming', ({ callId, callerId }: { callId: string; callerId: string }) => {
      this.incomingCallHandlers.forEach((h) => h(callId, callerId));
    });

    this.socket.on('call:accepted', ({ callId }: { callId: string }) => {
      this.callAcceptedHandlers.get(callId)?.(callId);
    });

    this.socket.on('call:ended', ({ callId }: { callId: string }) => {
      this.callEndedHandlers.get(callId)?.(callId);
    });
  }

  initiateCall(calleeId: string): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeId, offer: {} });
    return callId;
  }

  acceptCall(callId: string): void {
    this.socket?.emit('call:accept', { callId, answer: {} });
  }

  endCall(callId: string): void {
    this.socket?.emit('call:end', { callId });
  }

  onIncomingCall(handler: IncomingCallHandler): void {
    this.incomingCallHandlers.push(handler);
  }

  onCallAccepted(callId: string, handler: CallAcceptedHandler): void {
    this.callAcceptedHandlers.set(callId, handler);
  }

  onCallEnded(callId: string, handler: CallEndedHandler): void {
    this.callEndedHandlers.set(callId, handler);
  }
}

export const signalingService = new SignalingService();
