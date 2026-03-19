// src/routes/metrics.ts
// Exposes Prometheus metrics at GET /metrics for Grafana/Prometheus scraping.
// This endpoint is intentionally NOT behind JWT auth so Prometheus can scrape
// it without a token. Restrict access at the network level (firewall / k8s
// NetworkPolicy) in production — only the Prometheus server should reach it.

import { Router, Request, Response } from 'express';
import { metricsRegistry } from '../metrics/registry';

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

export default router;
