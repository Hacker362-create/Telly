// src/index.ts
// Main entry point for the Telly backend server.
// Starts the Express HTTP server, Socket.io signaling, and Mediasoup SFU.

import 'dotenv/config';
import * as http from 'http';
import express from 'express';
import { createSignalingServer } from './signaling/server';
import authRouter from './routes/auth';
import subscriptionRouter from './routes/subscription';
import { getOrCreateWorker } from './media/Worker';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'telly-backend' }));
app.use('/auth', authRouter);
app.use('/subscription', subscriptionRouter);

const httpServer = http.createServer(app);
createSignalingServer(httpServer);

const PORT = parseInt(process.env.PORT ?? '3000', 10);
httpServer.listen(PORT, () => {
  console.log(`Telly backend listening on port ${PORT}`);

  // Start the Mediasoup SFU worker after the HTTP server is up
  getOrCreateWorker()
    .then(() => console.log('[Boot] Mediasoup SFU worker ready'))
    .catch((err) => console.error('[Boot] Failed to start Mediasoup worker:', err));
});

export { app, httpServer };
