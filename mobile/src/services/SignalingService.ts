// mobile/src/services/SignalingService.ts
// WebSocket signaling client using Socket.io for call management.
// Handles SDP offer/answer relay and ICE candidate exchange for WebRTC.

import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SIGNALING_URL
  ?? 'https://api.telly.co.ke';

type IncomingCallHandler = (callId: string, callerId: string) => void;
type CallAcceptedHandler = (callId: string, answer?: object) => void;
type CallEndedHandler = (callId: string) => void;
type CallRejectedHandler = (callId: string, reason?: string) => void;
type CallUnavailableHandler = (callId: string, reason?: string) => void;
type OfferHandler = (offer: object) => void;
type IceCandidateHandler = (candidate: object) => void;
type CallQueuedHandler = (etaMs: number) => void;
type SubscriptionGraceHandler = (message: string) => void;
type IceRestartHandler = () => void;
type RelayModeHandler = () => void;

export type CallEndStats = {
  durationMs: number;
  dataBytes: number;
  avgLatencyMs: number;
  packetLossPct: number;
  success: boolean;
  networkType?: string;
  iceRestartCount?: number;
  relayUsed?: boolean;
  reconnectionEvents?: number;
};

class SignalingService {
  private socket: Socket | null = null;
  private incomingCallHandlers: IncomingCallHandler[] = [];
  private callAcceptedHandlers = new Map<string, CallAcceptedHandler>();
  private callEndedHandlers = new Map<string, CallEndedHandler>();
  private callRejectedHandlers = new Map<string, CallRejectedHandler>();
  private callUnavailableHandlers = new Map<string, CallUnavailableHandler>();
  private offerHandlers = new Map<string, OfferHandler>();
  private pendingOffers = new Map<string, object>();
  private iceCandidateHandlers = new Map<string, IceCandidateHandler>();
  private callQueuedHandlers = new Map<string, CallQueuedHandler>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private subscriptionGraceHandlers: SubscriptionGraceHandler[] = [];
  private iceRestartHandlers = new Map<string, IceRestartHandler>();
  private relayModeHandlers = new Map<string, RelayModeHandler>();

  private encodePayload(payload: object): Uint8Array | object {
    const Encoder = (globalThis as { TextEncoder?: new () => { encode: (v: string) => Uint8Array } }).TextEncoder;
    if (!Encoder) return payload;
    try {
      return new Encoder().encode(JSON.stringify(payload));
    } catch {
      return payload;
    }
  }

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
      reconnectionDelay: 300,
      reconnectionDelayMax: 900,
      timeout: 5000,
    });

    this.socket.on('call:incoming', ({ callId, callerId, offer }: { callId: string; callerId: string; offer?: object }) => {
      this.incomingCallHandlers.forEach((h) => h(callId, callerId));
      // Deliver the offer to any waiting handler for this callId
      if (offer) {
        const handler = this.offerHandlers.get(callId);
        if (handler) {
          handler(offer);
        } else {
          // Buffer offer until callee opens call screen and registers onOffer.
          this.pendingOffers.set(callId, offer);
        }
      }
    });

    this.socket.on('call:accepted', ({ callId, answer }: { callId: string; answer?: object }) => {
      this.callAcceptedHandlers.get(callId)?.(callId, answer);
    });

    this.socket.on('call:ended', ({ callId }: { callId: string }) => {
      this.callEndedHandlers.get(callId)?.(callId);
      this.callAcceptedHandlers.delete(callId);
      this.callEndedHandlers.delete(callId);
      this.callRejectedHandlers.delete(callId);
      this.callUnavailableHandlers.delete(callId);
      this.offerHandlers.delete(callId);
      this.pendingOffers.delete(callId);
      this.iceCandidateHandlers.delete(callId);
      this.callQueuedHandlers.delete(callId);
      this.iceRestartHandlers.delete(callId);
      this.relayModeHandlers.delete(callId);
    });

    this.socket.on('call:rejected', ({ callId, reason }: { callId: string; reason?: string }) => {
      this.callRejectedHandlers.get(callId)?.(callId, reason);
      this.callAcceptedHandlers.delete(callId);
      this.callEndedHandlers.delete(callId);
      this.callRejectedHandlers.delete(callId);
      this.callUnavailableHandlers.delete(callId);
      this.offerHandlers.delete(callId);
      this.pendingOffers.delete(callId);
      this.iceCandidateHandlers.delete(callId);
      this.callQueuedHandlers.delete(callId);
      this.iceRestartHandlers.delete(callId);
      this.relayModeHandlers.delete(callId);
    });

    this.socket.on('call:unavailable', ({ callId, reason }: { callId: string; reason?: string }) => {
      this.callUnavailableHandlers.get(callId)?.(callId, reason);
      this.callAcceptedHandlers.delete(callId);
      this.callEndedHandlers.delete(callId);
      this.callRejectedHandlers.delete(callId);
      this.callUnavailableHandlers.delete(callId);
      this.offerHandlers.delete(callId);
      this.pendingOffers.delete(callId);
      this.iceCandidateHandlers.delete(callId);
      this.callQueuedHandlers.delete(callId);
      this.iceRestartHandlers.delete(callId);
      this.relayModeHandlers.delete(callId);
    });

    this.socket.on('call:queued', ({ callId, etaMs }: { callId: string; etaMs: number }) => {
      this.callQueuedHandlers.get(callId)?.(etaMs);
    });

    this.socket.on('subscription:grace', ({ message }: { message: string }) => {
      this.subscriptionGraceHandlers.forEach((h) => h(message));
    });

    this.heartbeat = setInterval(() => {
      this.socket?.emit('presence:heartbeat');
    }, 15000);

    this.socket.on('ice:candidate', ({ callId, candidate }: { callId: string; candidate: object }) => {
      this.iceCandidateHandlers.get(callId)?.(candidate);
    });

    this.socket.on('ice:restart', ({ callId }: { callId: string }) => {
      this.iceRestartHandlers.get(callId)?.();
    });

    this.socket.on('call:relay-mode', ({ callId, relay }: { callId: string; relay: boolean }) => {
      if (relay) this.relayModeHandlers.get(callId)?.();
    });
  }

  /** Disconnect from the signaling server (called on logout). */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.incomingCallHandlers = [];
    this.callAcceptedHandlers.clear();
    this.callEndedHandlers.clear();
    this.callRejectedHandlers.clear();
    this.callUnavailableHandlers.clear();
    this.offerHandlers.clear();
    this.pendingOffers.clear();
    this.iceCandidateHandlers.clear();
    this.callQueuedHandlers.clear();
    this.iceRestartHandlers.clear();
    this.relayModeHandlers.clear();
    this.subscriptionGraceHandlers = [];
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  // ── Call initiation ────────────────────────────────────────────────────────

  /** Initiate a call without an SDP offer (offer is sent separately via sendOffer). */
  initiateCall(calleeId: string): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeId, callId });
    return callId;
  }

  initiateCallByTellyId(calleeTellyId: string): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeTellyId, callId });
    return callId;
  }

  warmupCall(calleeId: string): void {
    this.socket?.emit('call:warmup', { calleeId });
  }

  /** Initiate a call and immediately include the SDP offer in the same event. */
  initiateCallWithOffer(calleeId: string, offer: object): string {
    const callId = `call_${Date.now()}`;
    this.socket?.emit('call:initiate', { calleeId, callId, offer });
    return callId;
  }

  /** Send the SDP offer for an already-initiated call (called after WebRTC offer is created). */
  sendOffer(callId: string, offer: object): void {
    const payload = this.encodePayload({ offer });
    if (payload instanceof Uint8Array) {
      this.socket?.emit('call:offer:bin', { callId, payload });
      return;
    }
    this.socket?.emit('call:offer', { callId, offer });
  }

  /** Accept an incoming call with an SDP answer. */
  acceptCallWithAnswer(callId: string, answer: object): void {
    const payload = this.encodePayload({ answer });
    if (payload instanceof Uint8Array) {
      this.socket?.emit('call:accept:bin', { callId, payload });
      return;
    }
    this.socket?.emit('call:accept', { callId, answer });
  }

  /** Accept an incoming call without an SDP answer (legacy / no-WebRTC path). */
  acceptCall(callId: string): void {
    this.socket?.emit('call:accept', { callId, answer: {} });
  }

  rejectCall(callId: string, reason = 'rejected'): void {
    this.socket?.emit('call:reject', { callId, reason });
  }

  endCall(callId: string, stats?: CallEndStats): void {
    this.socket?.emit('call:end', { callId, stats });
  }

  sendReliabilitySnapshot(callId: string, payload: {
    latencyMs: number;
    packetLossPct: number;
    dataBytes: number;
    networkType?: string;
    iceRestartCount?: number;
    relayUsed?: boolean;
    reconnectionEvents?: number;
  }): void {
    this.socket?.emit('call:reliability', { callId, ...payload });
  }

  requestRelayFallback(callId: string): void {
    this.socket?.emit('call:relay-request', { callId });
  }

  triggerIceRestart(callId: string): void {
    this.socket?.emit('ice:restart', { callId });
  }

  /** Relay a local ICE candidate to the remote peer. */
  sendIceCandidate(callId: string, candidate: object): void {
    const payload = this.encodePayload({ candidate });
    if (payload instanceof Uint8Array) {
      this.socket?.emit('ice:candidate:bin', { callId, payload });
      return;
    }
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

  onCallRejected(callId: string, handler: CallRejectedHandler): void {
    this.callRejectedHandlers.set(callId, handler);
  }

  onCallUnavailable(callId: string, handler: CallUnavailableHandler): void {
    this.callUnavailableHandlers.set(callId, handler);
  }

  /** Register a one-time handler for the SDP offer for a given call (callee side). */
  onOffer(callId: string, handler: OfferHandler): void {
    this.offerHandlers.set(callId, handler);
    const buffered = this.pendingOffers.get(callId);
    if (buffered) {
      this.pendingOffers.delete(callId);
      handler(buffered);
    }
  }

  /** Register a handler for remote ICE candidates for a given call. */
  onIceCandidate(callId: string, handler: IceCandidateHandler): void {
    this.iceCandidateHandlers.set(callId, handler);
  }

  onCallQueued(callId: string, handler: CallQueuedHandler): void {
    this.callQueuedHandlers.set(callId, handler);
  }

  onSubscriptionGrace(handler: SubscriptionGraceHandler): void {
    this.subscriptionGraceHandlers.push(handler);
  }

  onIceRestart(callId: string, handler: IceRestartHandler): void {
    this.iceRestartHandlers.set(callId, handler);
  }

  onRelayMode(callId: string, handler: RelayModeHandler): void {
    this.relayModeHandlers.set(callId, handler);
  }
}

export const signalingService = new SignalingService();
