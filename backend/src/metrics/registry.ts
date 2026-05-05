// src/metrics/registry.ts
// Shared Prometheus metrics registry for the Telly backend.
// All counters and gauges are created here and reused across modules so
// that a single `prom-client` Registry instance is never duplicated.

import client from 'prom-client';

// Collect default Node.js metrics (event loop lag, heap size, GC, etc.)
client.collectDefaultMetrics({ prefix: 'telly_node_' });

// ── Call metrics ──────────────────────────────────────────────────────────────

/** Number of calls currently in progress (two-party or multi-party). */
export const activeCallsGauge = new client.Gauge({
  name: 'telly_active_calls',
  help: 'Number of calls currently in progress',
});

/** Total calls started since process launch. */
export const callsStartedCounter = new client.Counter({
  name: 'telly_calls_started_total',
  help: 'Total number of calls initiated',
});

/** Total calls ended since process launch (normal or dropped). */
export const callsEndedCounter = new client.Counter({
  name: 'telly_calls_ended_total',
  help: 'Total number of calls that have ended',
});

/** Total connected calls that reached active media state. */
export const callsConnectedCounter = new client.Counter({
  name: 'telly_calls_connected_total',
  help: 'Total calls that reached connected state',
});

/** Total calls marked failed by client-side reliability reporting. */
export const callFailuresCounter = new client.Counter({
  name: 'telly_call_failures_total',
  help: 'Total calls that failed (never stabilized or dropped early)',
});

/** Call duration distribution in milliseconds since process launch. */
export const callDurationHistogram = new client.Histogram({
  name: 'telly_call_duration_ms',
  help: 'Call duration distribution in milliseconds',
  buckets: [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000],
});

/** End-to-end call setup time in ms (initiate -> accepted). */
export const callSetupLatencyHistogram = new client.Histogram({
  name: 'telly_call_setup_latency_ms',
  help: 'Call setup latency in milliseconds',
  buckets: [100, 300, 500, 800, 1000, 1500, 3000, 5000],
});

/** Packet loss percentage observed client-side during active calls. */
export const callPacketLossHistogram = new client.Histogram({
  name: 'telly_call_packet_loss_pct',
  help: 'Packet loss percentage observed in active calls',
  buckets: [0.5, 1, 2, 4, 6, 10, 20],
});

/** Call RTT/latency observed client-side (ms). */
export const callLatencyHistogram = new client.Histogram({
  name: 'telly_call_latency_ms',
  help: 'Call network latency observed in milliseconds',
  buckets: [40, 80, 120, 180, 250, 350, 500, 800],
});

/** Total call media bytes exchanged as reported by clients. */
export const callDataBytesCounter = new client.Counter({
  name: 'telly_call_data_bytes_total',
  help: 'Total audio media bytes consumed by calls',
});

// ── Transport metrics ─────────────────────────────────────────────────────────

/** Number of live Mediasoup WebRTC transports. */
export const activeTransportsGauge = new client.Gauge({
  name: 'telly_active_transports',
  help: 'Number of open Mediasoup WebRTC transports',
});

/** Total WebRTC transports created since process launch. */
export const transportsCreatedCounter = new client.Counter({
  name: 'telly_transports_created_total',
  help: 'Total Mediasoup WebRTC transports created',
});

// ── Room metrics ──────────────────────────────────────────────────────────────

/** Number of active multi-party rooms. */
export const activeRoomsGauge = new client.Gauge({
  name: 'telly_active_rooms',
  help: 'Number of active multi-party rooms',
});

// ── Presence metrics ─────────────────────────────────────────────────────────

/** Number of users currently online (presence status = online or busy). */
export const onlineUsersGauge = new client.Gauge({
  name: 'telly_online_users',
  help: 'Number of users with an active presence (online or busy)',
});

// ── Messaging metrics ─────────────────────────────────────────────────────────

/** Total messages sent since process launch. */
export const messagesSentCounter = new client.Counter({
  name: 'telly_messages_sent_total',
  help: 'Total in-app messages sent',
});

// ── Voicemail metrics ─────────────────────────────────────────────────────────

/** Total voicemails left since process launch. */
export const voicemailsLeftCounter = new client.Counter({
  name: 'telly_voicemails_left_total',
  help: 'Total voicemails left by callers',
});

// ── Auth metrics ──────────────────────────────────────────────────────────────

/** Total successful logins since process launch. */
export const loginsCounter = new client.Counter({
  name: 'telly_logins_total',
  help: 'Total successful user logins',
});

/** Total failed login attempts since process launch. */
export const loginFailuresCounter = new client.Counter({
  name: 'telly_login_failures_total',
  help: 'Total failed login attempts',
});

// ── Push notification metrics ─────────────────────────────────────────────────

/** Total device push tokens registered via REST since process launch. */
export const pushTokensRegisteredCounter = new client.Counter({
  name: 'telly_push_tokens_registered_total',
  help: 'Total device push tokens registered via the REST API',
  labelNames: ['platform'],
});

/** Total push notifications successfully dispatched since process launch. */
export const pushNotificationsSentCounter = new client.Counter({
  name: 'telly_push_notifications_sent_total',
  help: 'Total push notifications dispatched',
  labelNames: ['type', 'platform'],
});

export const metricsRegistry = client.register;
