// tests/media.test.ts
// Unit tests for the Mediasoup transport REST API (/media/*).
// Mocks Mediasoup worker/router so no real media process is spawned.

import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mediaRouter, { liveTransports } from '../src/routes/media';

const JWT_SECRET = 'telly-secret-change-in-production';
function token(id = 'test-user'): string {
  return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mediasoup mock ─────────────────────────────────────────────────────────────
// We mock the Worker module so the tests never touch real Mediasoup processes.
// NOTE: jest.mock factories are hoisted, so they cannot reference outer consts.
//       All mock objects are defined inside the factory and exposed via a getter.

jest.mock('../src/media/Worker', () => {
  // Build fresh stubs inside the factory (no reference to outer scope)
  const transport = {
    id: 'transport-1',
    iceParameters: { usernameFragment: 'uf', password: 'pw', iceLite: false },
    iceCandidates: [],
    dtlsParameters: { fingerprints: [], role: 'auto' },
    connect: jest.fn().mockResolvedValue(undefined),
    produce: jest.fn().mockResolvedValue({ id: 'producer-1', on: jest.fn(), close: jest.fn() }),
    consume: jest.fn().mockResolvedValue({
      id: 'consumer-1', producerId: 'producer-1', kind: 'audio',
      rtpParameters: { codecs: [] }, on: jest.fn(), close: jest.fn(),
    }),
    on: jest.fn(),
    close: jest.fn(),
  };

  const router = {
    rtpCapabilities: {
      codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 }],
      headerExtensions: [],
    },
    canConsume: jest.fn().mockReturnValue(true),
  };

  return {
    getOrCreateRouter: jest.fn().mockResolvedValue(router),
    createWebRtcTransport: jest.fn().mockResolvedValue({
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    }),
    __router: router,
    __transport: transport,
  };
});

// ── Helpers to get the mock instances from the module ─────────────────────────
function getWorkerMock() {
  return jest.requireMock('../src/media/Worker') as {
    getOrCreateRouter: jest.Mock;
    createWebRtcTransport: jest.Mock;
    __router: { rtpCapabilities: object; canConsume: jest.Mock };
    __transport: {
      id: string;
      connect: jest.Mock;
      produce: jest.Mock;
      consume: jest.Mock;
      on: jest.Mock;
    };
  };
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/media', mediaRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /media/rtp-capabilities', () => {
  const app = makeApp();

  it('returns 401 without token', async () => {
    const res = await request(app).get('/media/rtp-capabilities');
    expect(res.status).toBe(401);
  });

  it('returns router RTP capabilities', async () => {
    const res = await request(app)
      .get('/media/rtp-capabilities')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('codecs');
    expect(Array.isArray(res.body.codecs)).toBe(true);
  });
});

describe('POST /media/transports', () => {
  const app = makeApp();

  it('returns 401 without token', async () => {
    const res = await request(app).post('/media/transports');
    expect(res.status).toBe(401);
  });

  it('creates a transport and returns ICE/DTLS params', async () => {
    const res = await request(app)
      .post('/media/transports')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'transport-1',
      iceParameters: expect.any(Object),
      iceCandidates: expect.any(Array),
      dtlsParameters: expect.any(Object),
    });
    // The transport should be registered in the live map
    expect(liveTransports.has('transport-1')).toBe(true);
  });
});

describe('POST /media/transports/:id/connect', () => {
  const app = makeApp();

  beforeAll(() => {
    const { __transport } = getWorkerMock();
    liveTransports.set('transport-1', __transport as never);
  });

  it('returns 404 for unknown transport', async () => {
    const res = await request(app)
      .post('/media/transports/nonexistent/connect')
      .set('Authorization', `Bearer ${token()}`)
      .send({ dtlsParameters: {} });
    expect(res.status).toBe(404);
  });

  it('returns 400 when dtlsParameters is missing', async () => {
    const res = await request(app)
      .post('/media/transports/transport-1/connect')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('connects the transport', async () => {
    const { __transport } = getWorkerMock();
    const dtlsParameters = { fingerprints: [{ algorithm: 'sha-256', value: 'AA:BB' }], role: 'client' };
    const res = await request(app)
      .post('/media/transports/transport-1/connect')
      .set('Authorization', `Bearer ${token()}`)
      .send({ dtlsParameters });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(__transport.connect).toHaveBeenCalledWith({ dtlsParameters });
  });
});

describe('POST /media/transports/:id/produce', () => {
  const app = makeApp();

  beforeAll(() => {
    const { __transport } = getWorkerMock();
    liveTransports.set('transport-1', __transport as never);
  });

  it('returns 404 for unknown transport', async () => {
    const res = await request(app)
      .post('/media/transports/bad-id/produce')
      .set('Authorization', `Bearer ${token()}`)
      .send({ kind: 'audio', rtpParameters: {} });
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-audio kind', async () => {
    const res = await request(app)
      .post('/media/transports/transport-1/produce')
      .set('Authorization', `Bearer ${token()}`)
      .send({ kind: 'video', rtpParameters: {} });
    expect(res.status).toBe(400);
  });

  it('creates an audio producer', async () => {
    const rtpParameters = { codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2 }] };
    const res = await request(app)
      .post('/media/transports/transport-1/produce')
      .set('Authorization', `Bearer ${token()}`)
      .send({ kind: 'audio', rtpParameters });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('producerId', 'producer-1');
  });
});

describe('POST /media/transports/:id/consume', () => {
  const app = makeApp();
  const mockRtpCapabilities = { codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 }] };

  beforeAll(() => {
    const { __transport } = getWorkerMock();
    liveTransports.set('transport-1', __transport as never);
  });

  it('returns 400 when producerId is missing', async () => {
    const res = await request(app)
      .post('/media/transports/transport-1/consume')
      .set('Authorization', `Bearer ${token()}`)
      .send({ rtpCapabilities: mockRtpCapabilities });
    expect(res.status).toBe(400);
  });

  it('returns 400 when canConsume returns false', async () => {
    const { __router } = getWorkerMock();
    __router.canConsume.mockReturnValueOnce(false);
    const res = await request(app)
      .post('/media/transports/transport-1/consume')
      .set('Authorization', `Bearer ${token()}`)
      .send({ producerId: 'producer-1', rtpCapabilities: mockRtpCapabilities });
    expect(res.status).toBe(400);
  });

  it('creates a consumer', async () => {
    const res = await request(app)
      .post('/media/transports/transport-1/consume')
      .set('Authorization', `Bearer ${token()}`)
      .send({ producerId: 'producer-1', rtpCapabilities: mockRtpCapabilities });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      consumerId: 'consumer-1',
      producerId: 'producer-1',
      kind: 'audio',
    });
  });
});
