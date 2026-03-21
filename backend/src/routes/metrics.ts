// src/routes/metrics.ts
// Exposes Prometheus metrics at GET /metrics for Grafana/Prometheus scraping.
// This endpoint is intentionally NOT behind JWT auth so Prometheus can scrape
// it without a token. Restrict access at the network level (firewall / k8s
// NetworkPolicy) in production — only the Prometheus server should reach it.

import { Router, Request, Response } from 'express';
import {
  metricsRegistry,
  callsStartedCounter,
  callFailuresCounter,
  callLatencyHistogram,
} from '../metrics/registry';

const router = Router();

/**
 * GET /metrics
 * Returns all registered Prometheus metrics in the standard text exposition
 * format (text/plain; version=0.0.4).
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

async function metricTotal(metric: { get: () => Promise<{ values: Array<{ value: number }> }> }, fallback = 0): Promise<number> {
  try {
    const snapshot = await metric.get();
    const value = snapshot.values.reduce((sum, v) => sum + Number(v.value || 0), 0);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

router.get('/success-rate', async (_req: Request, res: Response): Promise<void> => {
  const started = await metricTotal(callsStartedCounter, 0);
  const failures = await metricTotal(callFailuresCounter, 0);

  const successRate = started > 0 ? ((started - failures) / started) * 100 : 100;
  const dropRate = started > 0 ? (failures / started) * 100 : 0;

  const latency = await callLatencyHistogram.get();
  const sum = latency.values.find((v) => (v.metricName ?? '').endsWith('_sum'))?.value ?? 0;
  const count = latency.values.find((v) => (v.metricName ?? '').endsWith('_count'))?.value ?? 0;
  const avgLatency = count > 0 ? sum / count : 0;

  res.json({
    successRate: Number(successRate.toFixed(1)),
    avgLatency: Math.round(avgLatency),
    dropRate: Number(dropRate.toFixed(1)),
  });
});

export default router;
