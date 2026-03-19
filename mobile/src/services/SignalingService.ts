// mobile/src/services/SignalingService.ts
// WebSocket signaling client using Socket.io for call management.
// Handles SDP offer/answer relay and ICE candidate exchange for WebRTC.

import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.SIGNALING_URL ?? 'https://api.telly.co.ke';

type IncomingCallHandler = (callId: string, callerId: string) => void;
type CallAcceptedHandler = (callId: string, answer?: object) => void;
type CallEndedHandler = (callId: string) => void;
type OfferHandler = (offer: object) => void;
type IceCandidateHandler = (candidate: object) => void;

class SignalingService {
  private socket: Socket | null = null;
  private incomingCallHandlers: IncomingCallHandler[] = [];
  private callAcceptedHandlers = new Map<string, CallAcceptedHandler>();
  private callEndedHandlers = new Map<string, CallEndedHandler>();
  private offerHandlers = new Map<string, OfferHandler>();
  private iceCandidateHandlers = new Map<string, IceCandidateHandler>();

  /**
   * Connect to the signaling server.
   * @param userId   The authenticated user's ID
   * @param token    JWT token for the Gatekeeper middleware
   * @param fcmToken Optional FCM device token for background push notifications
   */
  connect(userId: string, token: string, fcmToken?: string): void {
    // Avoid duplicate connections
    if (this.socket?.connected) return;

    this.socket = io(SIGNALING_URL, {
      auth: { userId, token, fcmToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    this.socket.on('call:incoming', ({ callId, callerId, offer }: { callId: string; callerId: string; offer?: object }) => {
      this.incomingCallHandlers.forEach((h) => h(callId, callerId));
      // Deliver the offer to any waiting handler for this callId
      if (offer) this.offerHandlers.get(callId)?.(offer);
    });

    this.socket.on('call:accepted', ({ callId, answer }: { callId: string; answer?: object }) => {
      this.callAcceptedHandlers.get(callId)?.(callId, answer);
    });

    this.socket.on('call:ended', ({ callId }: { callId: string }) => {
      this.callEndedHandlers.get(callId)?.(callId);
      this.callAcceptedHandlers.delete(callId);
      this.callEndedHandlers.delete(callId);
      this.offerHandlers.delete(callId);
      this.iceCandidateHandlers.delete(callId);
    });

    this.socket.on('ice:candidate', ({ callId, candidate }: { callId: string; candidate: object }) => {
      this.iceCandidateHandlers.get(callId)?.(candidate);
    });
  }

  /** Disconnect from the signaling server (called on logout). */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.incomingCallHandlers = [];
    this.callAcceptedHandlers.clear();
    this.callEndedHandlers.clear();
    this.offerHandlers.clear();
    this.iceCandidateHandlers.clear();
  }

  // ── Call initiation ────────────────────────────────────────────────────────

  /** Initiate a call without an SDP offer (offer is sent separately via sendOffer). */
  initiateCall(calleeId: string): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeId, callId });
    return callId;
  }

  /** Initiate a call and immediately include the SDP offer in the same event. */
  initiateCallWithOffer(calleeId: string, offer: object): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeId, callId, offer });
    return callId;
  }

  /** Send the SDP offer for an already-initiated call (called after WebRTC offer is created). */
  sendOffer(callId: string, offer: object): void {
    this.socket?.emit('call:offer', { callId, offer });
  }

  /** Accept an incoming call with an SDP answer. */
  acceptCallWithAnswer(callId: string, answer: object): void {
    this.socket?.emit('call:accept', { callId, answer });
  }

  /** Accept an incoming call without an SDP answer (legacy / no-WebRTC path). */
  acceptCall(callId: string): void {
    this.socket?.emit('call:accept', { callId, answer: {} });
  }

  endCall(callId: string): void {
    this.socket?.emit('call:end', { callId });
  }

  /** Relay a local ICE candidate to the remote peer. */
  sendIceCandidate(callId: string, candidate: object): void {
    this.socket?.emit('ice:candidate', { callId, candidate });
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  onIncomingCall(handler: IncomingCallHandler): void {
    this.incomingCallHandlers.push(handler);
  }

  onCallAccepted(callId: string, handler: CallAcceptedHandler): void {
    this.callAcceptedHandlers.set(callId, handler);
  }

  onCallEnded(callId: string, handler: CallEndedHandler): void {
    this.callEndedHandlers.set(callId, handler);
  }

  /** Register a one-time handler for the SDP offer for a given call (callee side). */
  onOffer(callId: string, handler: OfferHandler): void {
    this.offerHandlers.set(callId, handler);
  }

  /** Register a handler for remote ICE candidates for a given call. */
  onIceCandidate(callId: string, handler: IceCandidateHandler): void {
    this.iceCandidateHandlers.set(callId, handler);
  }
}

export const signalingService = new SignalingService();
