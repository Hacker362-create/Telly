// src/index.ts
// Main entry point for the Telly backend server.
// Starts the Express HTTP server, Socket.io signaling, and Mediasoup SFU.

import 'dotenv/config';
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import { createSignalingServer } from './signaling/server';
import authRouter from './routes/auth';
import subscriptionRouter from './routes/subscription';
import callsRouter from './routes/calls';
import mediaRouter from './routes/media';
import contactsRouter from './routes/contacts';
import roomsRouter from './routes/rooms';
import metricsRouter from './routes/metrics';
import presenceRouter from './routes/presence';
import messagesRouter from './routes/messages';
import voicemailRouter from './routes/voicemail';
import pushTokensRouter from './routes/push-tokens';
import { getOrCreateWorker } from './media/Worker';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  // Allow the start-here.html launcher (file:// or any origin) to poll this endpoint
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ status: 'ok', service: 'telly-backend' });
});
app.use('/auth', authRouter);
app.use('/subscription', subscriptionRouter);
app.use('/calls', callsRouter);
app.use('/media', mediaRouter);
app.use('/media/rooms', roomsRouter);
app.use('/contacts', contactsRouter);
app.use('/presence', presenceRouter);
app.use('/messages', messagesRouter);
app.use('/voicemail', voicemailRouter);
app.use('/push-tokens', pushTokensRouter);
app.use('/metrics', metricsRouter);

const httpServer = http.createServer(app);
createSignalingServer(httpServer);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n✗ Port ${PORT} is already in use by another process.\n` +
      `  → Stop that process or set a different port: PORT=${PORT + 1} npm run dev\n`,
    );
  } else {
    console.error('\n✗ Server failed to start:', err.message);
  }
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`Telly backend listening on port ${PORT}`);

  // Start the Mediasoup SFU worker after the HTTP server is up
  getOrCreateWorker()
    .then(() => console.log('[Boot] Mediasoup SFU worker ready'))
    .catch((err) => console.error('[Boot] Failed to start Mediasoup worker:', err));
});

export { app, httpServer };
