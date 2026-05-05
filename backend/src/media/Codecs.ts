// src/media/Codecs.ts
// Telly optimized codec configuration for ultra-low bandwidth VoIP calls.
// Targets ~7MB/hour (vs WhatsApp's ~20MB+) using Opus DTX and 16kbps cap.

import type { RtpCodecCapability } from 'mediasoup/node/lib/types';

export const TELLY_CODECS: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: {
      usedtx: 1,            // Discontinuous Transmission: 0 packets during silence
      useinbandfec: 1,      // Forward Error Correction: fixes "robotic" voice on 3G
      maxaveragebitrate: 16000, // Hard limit to 16kbps (60% less than WhatsApp)
      complexity: 10,       // Highest CPU effort for best compression
      'sprop-stereo': 0,    // Mono audio saves additional bandwidth
    },
  },
];

export const TELLY_RTP_CAPABILITIES = {
  codecs: TELLY_CODECS,
  headerExtensions: [],
};

export interface CodecStats {
  mimeType: string;
  bitrate: number;
  dtxEnabled: boolean;
  fecEnabled: boolean;
}

export function getCodecStats(): CodecStats {
  const codec = TELLY_CODECS[0];
  return {
    mimeType: codec.mimeType,
    bitrate: codec.parameters?.maxaveragebitrate as number ?? 0,
    dtxEnabled: codec.parameters?.usedtx === 1,
    fecEnabled: codec.parameters?.useinbandfec === 1,
  };
}
