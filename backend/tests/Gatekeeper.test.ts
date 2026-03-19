import { gatekeeperMiddleware, setRedisClient } from '../src/signaling/Gatekeeper';
import type { Socket } from 'socket.io';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockFindUnique = jest.fn();
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      user: { findUnique: mockFindUnique },
    })),
    __mockFindUnique: mockFindUnique,
  };
});

// Mock Redis
const mockGet = jest.fn();
const mockSetex = jest.fn();
const mockRedis = { get: mockGet, setex: mockSetex };
setRedisClient(mockRedis);

const { __mockFindUnique } = jest.requireMock('@prisma/client') as {
  __mockFindUnique: jest.Mock;
};

function makeSocket(auth: Record<string, unknown>): Socket {
  return { handshake: { auth } } as unknown as Socket;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(null);
  mockSetex.mockResolvedValue('OK');
});

describe('gatekeeperMiddleware', () => {
  it('calls next with TELLY_AUTH_MISSING when userId is absent', async () => {
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({}), next);
    expect(next).toHaveBeenCalledWith(new Error('TELLY_AUTH_MISSING'));
  });

  it('allows connection when Redis cache says active', async () => {
    mockGet.mockResolvedValue('active');
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({ userId: 'user-1' }), next);
    expect(next).toHaveBeenCalledWith();
    expect(__mockFindUnique).not.toHaveBeenCalled();
  });

  it('blocks connection when subscription is expired', async () => {
    const expiredDate = new Date(Date.now() - 1000);
    __mockFindUnique.mockResolvedValue({ isActive: true, subscriptionExpiry: expiredDate });
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({ userId: 'user-2' }), next);
    expect(next).toHaveBeenCalledWith(new Error('TELLY_LINE_INACTIVE'));
  });

  it('blocks connection when user isActive is false', async () => {
    __mockFindUnique.mockResolvedValue({
      isActive: false,
      subscriptionExpiry: new Date(Date.now() + 86400000),
    });
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({ userId: 'user-3' }), next);
    expect(next).toHaveBeenCalledWith(new Error('TELLY_LINE_INACTIVE'));
  });

  it('allows connection and caches result for active subscriber', async () => {
    __mockFindUnique.mockResolvedValue({
      isActive: true,
      subscriptionExpiry: new Date(Date.now() + 86400000),
    });
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({ userId: 'user-4' }), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockSetex).toHaveBeenCalledWith('subscription:user-4', 60, 'active');
  });

  it('calls next with TELLY_INTERNAL_ERROR when DB throws', async () => {
    __mockFindUnique.mockRejectedValue(new Error('DB down'));
    const next = jest.fn();
    await gatekeeperMiddleware(makeSocket({ userId: 'user-5' }), next);
    expect(next).toHaveBeenCalledWith(new Error('TELLY_INTERNAL_ERROR'));
  });
});
