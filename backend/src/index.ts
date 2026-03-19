// src/index.ts
// Main entry point for the Telly backend server.
// Starts the Express HTTP server, Socket.io signaling, and Mediasoup SFU.

import 'dotenv/config';
import * as http from 'http';
import express from 'express';
import { createSignalingServer } from './signaling/server';
import authRouter from './routes/auth';
import subscriptionRouter from './routes/subscription';

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
});

export { app, httpServer };
