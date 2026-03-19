// tests/rooms.test.ts
// Unit tests for the multi-party room management API (/media/rooms/*).
// Mocks the Mediasoup Worker so no real media process is spawned.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import roomsRouter, { activeRooms } from '../src/routes/rooms';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'user-1'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mediasoup mock ─────────────────────────────────────────────────────────────
jest.mock('../src/media/Worker', () => {
  const makeTransport = () => ({
    id: `transport-${Math.random().toString(36).slice(2)}`,
    iceParameters: { usernameFragment: 'uf', password: 'pw', iceLite: false },
    iceCandidates: [],
    dtlsParameters: { fingerprints: [], role: 'auto' },
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    close: jest.fn(),
  });

  const router = {
    id: 'router-1',
    rtpCapabilities: {
      codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 }],
      headerExtensions: [],
    },
    canConsume: jest.fn().mockReturnValue(true),
  };

  return {
    getOrCreateRouter: jest.fn().mockResolvedValue(router),
    createWebRtcTransport: jest.fn().mockImplementation(async () => {
      const transport = makeTransport();
      return {
        transport,
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      };
    }),
  };
});

// Also mock media route's liveTransports so rooms can import it
jest.mock('../src/routes/media', () => ({
  liveTransports: new Map(),
  default: require('express').Router(),
}));

// ── App setup ──────────────────────────────────────────────────────────────────
function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/media/rooms', roomsRouter);
  return app;
}

describe('POST /media/rooms', () => {
  let app: Express;
  beforeEach(() => {
    app = makeApp();
    activeRooms.clear();
  });

  it('creates a room and returns roomId + transport params', async () => {
    const res = await request(app)
      .post('/media/rooms')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(201);
    expect(res.body.roomId).toBeTruthy();
    expect(res.body.transport).toHaveProperty('id');
    expect(res.body.rtpCapabilities).toHaveProperty('codecs');
    expect(res.body.participantCount).toBe(1);
  });

  it('registers the creator as the first participant', async () => {
    const res = await request(app)
      .post('/media/rooms')
      .set('Authorization', `Bearer ${token('user-1')}`);

    const room = activeRooms.get(res.body.roomId);
    expect(room?.participantIds.has('user-1')).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/media/rooms');
    expect(res.status).toBe(401);
  });
});

describe('GET /media/rooms/:id', () => {
  let app: Express;
  let roomId: string;

  beforeEach(async () => {
    app = makeApp();
    activeRooms.clear();
    const res = await request(app)
      .post('/media/rooms')
      .set('Authorization', `Bearer ${token('user-1')}`);
    roomId = res.body.roomId;
  });

  it('returns room metadata', async () => {
    const res = await request(app)
      .get(`/media/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(roomId);
    expect(res.body.participantCount).toBe(1);
  });

  it('returns 404 for a non-existent room', async () => {
    const res = await request(app)
      .get('/media/rooms/no-such-room')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /media/rooms/:id/join', () => {
  let app: Express;
  let roomId: string;

  beforeEach(async () => {
    app = makeApp();
    activeRooms.clear();
    const res = await request(app)
      .post('/media/rooms')
      .set('Authorization', `Bearer ${token('user-1')}`);
    roomId = res.body.roomId;
  });

  it('allows a second participant to join and returns new transport', async () => {
    const res = await request(app)
      .post(`/media/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${token('user-2')}`);

    expect(res.status).toBe(201);
    expect(res.body.participantCount).toBe(2);
    expect(res.body.transport).toHaveProperty('id');
  });

  it('increments the participant count per join', async () => {
    await request(app)
      .post(`/media/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${token('user-2')}`);
    const res = await request(app)
      .post(`/media/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${token('user-3')}`);

    expect(res.body.participantCount).toBe(3);
  });

  it('returns 404 when joining a non-existent room', async () => {
    const res = await request(app)
      .post('/media/rooms/ghost/join')
      .set('Authorization', `Bearer ${token('user-2')}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post(`/media/rooms/${roomId}/join`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /media/rooms/:id/leave', () => {
  let app: Express;
  let roomId: string;

  beforeEach(async () => {
    app = makeApp();
    activeRooms.clear();
    const createRes = await request(app)
      .post('/media/rooms')
      .set('Authorization', `Bearer ${token('user-1')}`);
    roomId = createRes.body.roomId;
    await request(app)
      .post(`/media/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${token('user-2')}`);
  });

  it('decrements the participant count when a user leaves', async () => {
    const res = await request(app)
      .delete(`/media/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${token('user-2')}`);

    expect(res.status).toBe(200);
    expect(res.body.participantCount).toBe(1);
  });

  it('deletes the room when the last participant leaves', async () => {
    await request(app)
      .delete(`/media/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${token('user-2')}`);
    await request(app)
      .delete(`/media/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(activeRooms.has(roomId)).toBe(false);
  });

  it('returns 404 for a non-existent room', async () => {
    const res = await request(app)
      .delete('/media/rooms/ghost/leave')
      .set('Authorization', `Bearer ${token('user-1')}`);

    expect(res.status).toBe(404);
  });
});
