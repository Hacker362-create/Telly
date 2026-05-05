// mobile/src/services/WebRTCService.ts
// Manages the peer-to-peer WebRTC session for a single Telly voice call.
// Uses react-native-webrtc for media capture and RTCPeerConnection management.
//
// Audio constraints are tuned for ultra-low bandwidth (matches server-side
// Opus DTX config: 16 kbps, mono, noise suppression, echo cancellation).

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

/** Low-bandwidth audio constraints — targets ~16 kbps with Opus DTX. */
const AUDIO_CONSTRAINTS = {
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

/** ICE server list. STUN only in MVP — add TURN servers for production. */
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type SessionDescriptionPayload = object;
type IceCandidatePayload = object;

type IceCandidateEmitter = (candidate: IceCandidatePayload) => void;
export type NetworkQuality = 'poor' | 'medium' | 'good';
export type CallTelemetry = {
  bytesSent: number;
  bytesReceived: number;
  latencyMs: number;
  packetLossPct: number;
  bitrate: number;
  networkQuality: NetworkQuality;
};

const BITRATE_BY_QUALITY: Record<NetworkQuality, number> = {
  poor: 6000,
  medium: 12000,
  good: 16000,
};

class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private iceCandidateEmitter: IceCandidateEmitter | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private telemetry: CallTelemetry = {
    bytesSent: 0,
    bytesReceived: 0,
    latencyMs: 0,
    packetLossPct: 0,
    bitrate: BITRATE_BY_QUALITY.good,
    networkQuality: 'good',
  };
  private qualityListeners: Array<(quality: NetworkQuality, bitrate: number) => void> = [];
  private telemetryListeners: Array<(stats: CallTelemetry) => void> = [];
  private iceRestartCount = 0;
  private relayMode = false;
  private reconnectionEvents = 0;
  private lastNetworkChangeAt = 0;
  private iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = DEFAULT_ICE_SERVERS;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Set up the peer connection and capture the microphone.
   * Must be called before createOffer() or setRemoteOffer().
   */
  async init(): Promise<void> {
    this.iceServers = await this.fetchIceServers();
    this.localStream = await mediaDevices.getUserMedia(AUDIO_CONSTRAINTS) as MediaStream;

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.relayMode ? 'relay' : 'all' });

    // Add local audio track to the peer connection
    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // Emit ICE candidates to the signaling layer as they are gathered
    (this.pc as unknown as { onicecandidate?: (event: { candidate: RTCIceCandidate | null }) => void }).onicecandidate = (event) => {
      if (event.candidate && this.iceCandidateEmitter) {
        this.iceCandidateEmitter(event.candidate.toJSON() as IceCandidatePayload);
      }
    };

    this.attachResilienceHooks();
    this.startTelemetryLoop();
  }

  /** Register a callback that will fire whenever a new local ICE candidate is ready. */
  onIceCandidate(emitter: IceCandidateEmitter): void {
    this.iceCandidateEmitter = emitter;
  }

  /** Release all media resources and close the peer connection. */
  close(): void {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.pc?.close();
    this.pc = null;
    this.iceCandidateEmitter = null;
    this.qualityListeners = [];
    this.telemetryListeners = [];
    this.iceRestartCount = 0;
    this.reconnectionEvents = 0;
    this.relayMode = false;
    this.lastNetworkChangeAt = 0;
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Caller flow ───────────────────────────────────────────────────────────

  /**
   * Create an SDP offer (caller side).
   * Returns the offer SDP that must be sent to the callee via signaling.
   */
  async createOffer(): Promise<SessionDescriptionPayload> {
    if (!this.pc) throw new Error('WebRTCService not initialised — call init() first');
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.pc.setLocalDescription(new RTCSessionDescription(offer));
    return offer as SessionDescriptionPayload;
  }

  /**
   * Apply the callee's SDP answer (caller side).
   */
  async setRemoteAnswer(answer: SessionDescriptionPayload): Promise<void> {
    if (!this.pc) throw new Error('WebRTCService not initialised');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer as never));
  }

  // ── Callee flow ───────────────────────────────────────────────────────────

  /**
   * Apply the caller's SDP offer and create an SDP answer (callee side).
   * Returns the answer SDP that must be sent back via signaling.
   */
  async answerOffer(offer: SessionDescriptionPayload): Promise<SessionDescriptionPayload> {
    if (!this.pc) throw new Error('WebRTCService not initialised — call init() first');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer as never));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(new RTCSessionDescription(answer));
    return answer as SessionDescriptionPayload;
  }

  // ── ICE handling ─────────────────────────────────────────────────────────

  /** Add a remote ICE candidate received via signaling. */
  async addIceCandidate(candidate: IceCandidatePayload): Promise<void> {
    if (!this.pc) return;
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate as never));
  }

  async restartIce(): Promise<void> {
    if (!this.pc) return;
    this.iceRestartCount += 1;
    const pcWithRestart = this.pc as RTCPeerConnection & { restartIce?: () => void };
    if (typeof pcWithRestart.restartIce === 'function') {
      pcWithRestart.restartIce();
      return;
    }
    const offer = await this.pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: false });
    await this.pc.setLocalDescription(new RTCSessionDescription(offer));
  }

  onQualityChanged(listener: (quality: NetworkQuality, bitrate: number) => void): void {
    this.qualityListeners.push(listener);
  }

  onTelemetry(listener: (stats: CallTelemetry) => void): void {
    this.telemetryListeners.push(listener);
  }

  getTelemetry(): CallTelemetry {
    return { ...this.telemetry };
  }

  getAdvancedStats(): { iceRestartCount: number; relayMode: boolean; reconnectionEvents: number } {
    return {
      iceRestartCount: this.iceRestartCount,
      relayMode: this.relayMode,
      reconnectionEvents: this.reconnectionEvents,
    };
  }

  async handleNetworkChange(): Promise<void> {
    const now = Date.now();
    if (now - this.lastNetworkChangeAt < 450) return;
    this.lastNetworkChangeAt = now;
    this.reconnectionEvents += 1;
    await this.restartIce();
  }

  async enableRelayMode(): Promise<void> {
    this.relayMode = true;
    if (!this.pc) return;
    const pcWithConfig = this.pc as RTCPeerConnection & { setConfiguration?: (config: unknown) => void };
    pcWithConfig.setConfiguration?.({
      iceServers: this.iceServers,
      iceTransportPolicy: 'relay',
    });
    await this.restartIce();
  }

  // ── Mute control ──────────────────────────────────────────────────────────

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  private attachResilienceHooks(): void {
    if (!this.pc) return;
    const pcEvents = this.pc as unknown as {
      oniceconnectionstatechange?: () => void;
      onconnectionstatechange?: () => void;
      iceConnectionState?: string;
      connectionState?: string;
    };

    pcEvents.oniceconnectionstatechange = () => {
      const state = pcEvents.iceConnectionState;
      if (state === 'disconnected' || state === 'failed') {
        this.queueFastRecovery();
      }
    };

    pcEvents.onconnectionstatechange = () => {
      const state = pcEvents.connectionState;
      if (state === 'disconnected' || state === 'failed') {
        this.queueFastRecovery();
      }
    };
  }

  private queueFastRecovery(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectionEvents += 1;
      this.restartIce().catch(() => undefined);
    }, 700);
  }

  private startTelemetryLoop(): void {
    if (!this.pc || this.telemetryInterval) return;
    this.telemetryInterval = setInterval(() => {
      this.collectAndAdapt().catch(() => undefined);
    }, 2000);
  }

  private async collectAndAdapt(): Promise<void> {
    if (!this.pc) return;
    const stats = await this.pc.getStats();

    let bytesSent = 0;
    let bytesReceived = 0;
    let totalPacketsLost = 0;
    let totalPackets = 0;
    let rttMs = 0;

    stats.forEach((report: unknown) => {
      const r = report as Record<string, unknown>;
      if (r.type === 'outbound-rtp' && r.kind === 'audio') {
        bytesSent += Number(r.bytesSent ?? 0);
        totalPacketsLost += Number(r.packetsLost ?? 0);
        totalPackets += Number(r.packetsSent ?? 0);
      }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        bytesReceived += Number(r.bytesReceived ?? 0);
        totalPacketsLost += Number(r.packetsLost ?? 0);
        totalPackets += Number(r.packetsReceived ?? 0);
      }
      if (r.type === 'candidate-pair' && r.state === 'succeeded') {
        const currentRtt = Number(r.currentRoundTripTime ?? 0);
        if (currentRtt > 0) rttMs = Math.round(currentRtt * 1000);
      }
    });

    const lossPct = totalPackets > 0 ? (totalPacketsLost / totalPackets) * 100 : 0;
    const quality = this.deriveNetworkQuality(lossPct, rttMs);
    const bitrate = BITRATE_BY_QUALITY[quality];
    await this.applyBitrate(bitrate);

    this.telemetry = {
      bytesSent,
      bytesReceived,
      latencyMs: rttMs,
      packetLossPct: Number(lossPct.toFixed(2)),
      bitrate,
      networkQuality: quality,
    };

    this.qualityListeners.forEach((l) => l(quality, bitrate));
    this.telemetryListeners.forEach((l) => l({ ...this.telemetry }));
  }

  private deriveNetworkQuality(packetLossPct: number, latencyMs: number): NetworkQuality {
    if (packetLossPct >= 6 || latencyMs >= 350) return 'poor';
    if (packetLossPct >= 2 || latencyMs >= 180) return 'medium';
    return 'good';
  }

  private async applyBitrate(bitrate: number): Promise<void> {
    if (!this.pc) return;
    const senders = this.pc.getSenders?.() ?? [];
    for (const sender of senders) {
      if (!sender.track || sender.track.kind !== 'audio') continue;
      const params = sender.getParameters?.();
      if (!params) continue;

      const mutable = params as unknown as { encodings?: Array<{ maxBitrate?: number }> };
      if (!mutable.encodings || mutable.encodings.length === 0) continue;
      mutable.encodings[0].maxBitrate = bitrate;
      await sender.setParameters?.(mutable as never);
    }
  }

  private async fetchIceServers(): Promise<Array<{ urls: string | string[]; username?: string; credential?: string }>> {
    const token = await AsyncStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_URL}/media/ice-servers`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return DEFAULT_ICE_SERVERS;
      const payload = await res.json() as { iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> };
      if (!payload.iceServers || payload.iceServers.length === 0) return DEFAULT_ICE_SERVERS;
      return payload.iceServers;
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
  }

  // ── Mediasoup SFU helpers ─────────────────────────────────────────────────

  /**
   * Fetch the router's RTP capabilities from the server.
   * Used to initialise a mediasoup-client Device in SFU mode.
   */
  async fetchRtpCapabilities(): Promise<object> {
    const token = await AsyncStorage.getItem('authToken');
    const res = await fetch(`${API_URL}/media/rtp-capabilities`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to fetch RTP capabilities');
    return res.json() as Promise<object>;
  }
}

export const webRTCService = new WebRTCService();
