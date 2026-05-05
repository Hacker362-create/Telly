// tests/metrics.test.ts
// Unit tests for the Prometheus metrics endpoint (GET /metrics).

import express, { Express } from 'express';
import request from 'supertest';
import metricsRouter from '../src/routes/metrics';

// Re-import the registry after the route module has loaded it so we can
// inspect the same instance that the route handler uses.
import { metricsRegistry } from '../src/metrics/registry';

function makeApp(): Express {
  const app = express();
  app.use('/metrics', metricsRouter);
  return app;
}

describe('GET /metrics', () => {
  let app: Express;
  beforeEach(() => { app = makeApp(); });

  it('returns 200 with Prometheus text format', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('includes telly_active_calls gauge', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_active_calls');
  });

  it('includes telly_calls_started_total counter', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_calls_started_total');
  });

  it('includes telly_calls_ended_total counter', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_calls_ended_total');
  });

  it('includes telly_call_duration_ms histogram', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_call_duration_ms');
  });

  it('includes telly_active_transports gauge', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_active_transports');
  });

  it('includes telly_active_rooms gauge', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_active_rooms');
  });

  it('includes default Node.js metrics (telly_node_ prefix)', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('telly_node_');
  });

  it('does not require authentication', async () => {
    // /metrics must be reachable by Prometheus without a JWT
    const res = await request(app).get('/metrics');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
