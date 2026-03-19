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
  type RTCSessionDescriptionType,
  type RTCIceCandidateType,
} from 'react-native-webrtc';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.API_URL ?? 'https://api.telly.co.ke';

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
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type IceCandidateEmitter = (candidate: RTCIceCandidateType) => void;

class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private iceCandidateEmitter: IceCandidateEmitter | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Set up the peer connection and capture the microphone.
   * Must be called before createOffer() or setRemoteOffer().
   */
  async init(): Promise<void> {
    this.localStream = await mediaDevices.getUserMedia(AUDIO_CONSTRAINTS) as MediaStream;

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local audio track to the peer connection
    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // Emit ICE candidates to the signaling layer as they are gathered
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.iceCandidateEmitter) {
        this.iceCandidateEmitter(event.candidate.toJSON());
      }
    };
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
  }

  // ── Caller flow ───────────────────────────────────────────────────────────

  /**
   * Create an SDP offer (caller side).
   * Returns the offer SDP that must be sent to the callee via signaling.
   */
  async createOffer(): Promise<RTCSessionDescriptionType> {
    if (!this.pc) throw new Error('WebRTCService not initialised — call init() first');
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.pc.setLocalDescription(new RTCSessionDescription(offer));
    return offer;
  }

  /**
   * Apply the callee's SDP answer (caller side).
   */
  async setRemoteAnswer(answer: RTCSessionDescriptionType): Promise<void> {
    if (!this.pc) throw new Error('WebRTCService not initialised');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // ── Callee flow ───────────────────────────────────────────────────────────

  /**
   * Apply the caller's SDP offer and create an SDP answer (callee side).
   * Returns the answer SDP that must be sent back via signaling.
   */
  async answerOffer(offer: RTCSessionDescriptionType): Promise<RTCSessionDescriptionType> {
    if (!this.pc) throw new Error('WebRTCService not initialised — call init() first');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(new RTCSessionDescription(answer));
    return answer;
  }

  // ── ICE handling ─────────────────────────────────────────────────────────

  /** Add a remote ICE candidate received via signaling. */
  async addIceCandidate(candidate: RTCIceCandidateType): Promise<void> {
    if (!this.pc) return;
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  // ── Mute control ──────────────────────────────────────────────────────────

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
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
