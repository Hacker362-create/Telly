// src/routes/media.ts
// Mediasoup SFU transport REST API.
// Clients call these endpoints during call setup to negotiate WebRTC transports
// and connect their audio directly to the Mediasoup SFU worker.
//
// Typical flow per participant:
//   1. GET  /media/rtp-capabilities   → router.rtpCapabilities (build Device)
//   2. POST /media/transports          → create send transport, returns ICE/DTLS params
//   3. POST /media/transports/:id/connect → client sends DTLS fingerprint
//   4. POST /media/transports/:id/produce → client starts sending audio
//   5. POST /media/transports/:id/consume → client requests remote audio stream

import { Router, Response } from 'express';
import type { DtlsParameters, RtpParameters, RtpCapabilities } from 'mediasoup/node/lib/types';
import { getOrCreateRouter, createWebRtcTransport } from '../media/Worker';
import { requireAuth, AuthRequest, apiLimiter } from '../middleware/auth';

const router = Router();

// In-memory store of live transports indexed by transport ID.
// In production, this would be stored in Redis for multi-replica setups.
const liveTransports = new Map<string, import('mediasoup/node/lib/types').WebRtcTransport>();

function buildIceServers(): Array<{ urls: string | string[]; username?: string; credential?: string }> {
  const stun = (
    process.env.STUN_SERVERS
    ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> =
    stun.length > 0 ? [{ urls: stun }] : [];

  const turnUrls = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;
  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

router.get('/ice-servers', apiLimiter, requireAuth, (_req: AuthRequest, res: Response): void => {
  res.json({
    iceServers: buildIceServers(),
    relayRecommended: process.env.TURN_ENFORCE_RELAY === 'true',
  });
});

// ── GET /media/rtp-capabilities ───────────────────────────────────────────────
// Returns the router's RTP capabilities so the client can instantiate a
// mediasoup-client Device and know which codecs are supported.
router.get(
  '/rtp-capabilities',
  apiLimiter,
  requireAuth,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const r = await getOrCreateRouter();
    res.json(r.rtpCapabilities);
  },
);

// ── POST /media/transports ─────────────────────────────────────────────────────
// Create a new WebRtcTransport for the caller or callee.
// Returns the ICE parameters, ICE candidates, and DTLS parameters that the
// client needs to instantiate a mediasoup-client Transport.
router.post(
  '/transports',
  apiLimiter,
  requireAuth,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const { transport, params } = await createWebRtcTransport();
    liveTransports.set(transport.id, transport);

    // Clean up automatically when the transport is closed
    transport.on('routerclose', () => liveTransports.delete(transport.id));

    res.status(201).json(params);
  },
);

// ── POST /media/transports/:id/connect ────────────────────────────────────────
// Complete DTLS handshake by receiving the client's DTLS fingerprint.
// Must be called once per transport before producing or consuming.
router.post(
  '/transports/:id/connect',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const transport = liveTransports.get(req.params.id);
    if (!transport) {
      res.status(404).json({ error: 'Transport not found' });
      return;
    }

    const { dtlsParameters } = req.body as { dtlsParameters: DtlsParameters };
    if (!dtlsParameters) {
      res.status(400).json({ error: 'dtlsParameters required' });
      return;
    }

    await transport.connect({ dtlsParameters });
    res.json({ connected: true });
  },
);

// ── POST /media/transports/:id/produce ────────────────────────────────────────
// Create a Producer: the client starts sending audio through this transport.
// Returns the producer ID that the other participant will use to consume.
router.post(
  '/transports/:id/produce',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const transport = liveTransports.get(req.params.id);
    if (!transport) {
      res.status(404).json({ error: 'Transport not found' });
      return;
    }

    const { kind, rtpParameters } = req.body as {
      kind: 'audio';
      rtpParameters: RtpParameters;
    };

    if (kind !== 'audio') {
      res.status(400).json({ error: 'Only audio producers are supported' });
      return;
    }

    if (!rtpParameters) {
      res.status(400).json({ error: 'rtpParameters required' });
      return;
    }

    const producer = await transport.produce({ kind, rtpParameters });

    producer.on('transportclose', () => producer.close());

    res.status(201).json({ producerId: producer.id });
  },
);

// ── POST /media/transports/:id/consume ────────────────────────────────────────
// Create a Consumer: the client requests audio from a remote Producer.
// Returns RTP parameters so the client can start receiving the stream.
router.post(
  '/transports/:id/consume',
  apiLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const transport = liveTransports.get(req.params.id);
    if (!transport) {
      res.status(404).json({ error: 'Transport not found' });
      return;
    }

    const { producerId, rtpCapabilities } = req.body as {
      producerId: string;
      rtpCapabilities: RtpCapabilities;
    };

    if (!producerId || !rtpCapabilities) {
      res.status(400).json({ error: 'producerId and rtpCapabilities required' });
      return;
    }

    const r = await getOrCreateRouter();

    if (!r.canConsume({ producerId, rtpCapabilities })) {
      res.status(400).json({ error: 'Cannot consume: incompatible RTP capabilities' });
      return;
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false,
    });

    consumer.on('transportclose', () => consumer.close());
    consumer.on('producerclose', () => consumer.close());

    res.status(201).json({
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  },
);

export default router;
export { liveTransports };
