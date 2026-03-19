// src/media/Worker.ts
// Mediasoup SFU worker and router lifecycle management.
// Creates a single worker process and a router pre-configured with Telly's
// low-bandwidth Opus DTX codec. Both are singletons reused across all calls.

import * as mediasoup from 'mediasoup';
import type { Worker, Router, WebRtcTransport } from 'mediasoup/node/lib/types';
import { TELLY_CODECS } from './Codecs';

let worker: Worker | null = null;
let router: Router | null = null;

/**
 * Start (or return cached) Mediasoup worker.
 * The worker dies→restarts on fatal error rather than crashing the whole process.
 */
export async function getOrCreateWorker(): Promise<Worker> {
  if (worker) return worker;

  worker = await mediasoup.createWorker({
    rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT ?? '2000', 10),
    rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT ?? '2999', 10),
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  });

  worker.on('died', async (error) => {
    console.error('[Mediasoup] Worker died:', error);
    worker = null;
    router = null;
    // Re-create after a short delay so active calls attempt to resume
    setTimeout(() => getOrCreateWorker().catch(console.error), 2000);
  });

  console.log(`[Mediasoup] Worker PID ${worker.pid} started`);
  return worker;
}

/**
 * Return (or create) the single Mediasoup Router for all calls.
 * The router carries Telly's Opus DTX codec configuration.
 */
export async function getOrCreateRouter(): Promise<Router> {
  if (router) return router;

  const w = await getOrCreateWorker();
  router = await w.createRouter({ mediaCodecs: TELLY_CODECS });
  console.log('[Mediasoup] Router created, codecs:', router.rtpCapabilities.codecs?.length);
  return router;
}

/**
 * Create a WebRTC transport for a call participant (caller or callee).
 * Returns the transport along with the ICE/DTLS parameters that need to be
 * sent to the client so it can connect.
 */
export async function createWebRtcTransport(): Promise<{
  transport: WebRtcTransport;
  params: {
    id: string;
    iceParameters: WebRtcTransport['iceParameters'];
    iceCandidates: WebRtcTransport['iceCandidates'];
    dtlsParameters: WebRtcTransport['dtlsParameters'];
  };
}> {
  const r = await getOrCreateRouter();

  const listenIps: mediasoup.types.TransportListenIp[] = [
    {
      ip: process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0',
      announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? undefined,
    },
  ];

  const transport = await r.createWebRtcTransport({
    listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    // Match our 16 kbps codec cap to avoid unnecessary bandwidth probing
    initialAvailableOutgoingBitrate: 16000,
  });

  transport.on('dtlsstatechange', (dtlsState: string) => {
    if (dtlsState === 'closed') transport.close();
  });

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}
