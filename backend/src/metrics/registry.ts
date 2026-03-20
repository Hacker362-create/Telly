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

/** Call duration distribution in milliseconds since process launch. */
export const callDurationHistogram = new client.Histogram({
  name: 'telly_call_duration_ms',
  help: 'Call duration distribution in milliseconds',
  buckets: [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000],
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

export const metricsRegistry = client.register;
