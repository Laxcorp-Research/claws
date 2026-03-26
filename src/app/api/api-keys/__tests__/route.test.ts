import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest, parseResponse } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/api/auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: 'user-test-123',
    email: 'test@example.com',
    name: 'Test User',
    hasActiveSubscription: false,
  }),
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((val: string) => `v1:encrypted:${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 7)}...${val.slice(-4)}`),
}));

import { GET, POST } from '@/app/api/api-keys/route';

describe('GET /api/api-keys', () => {
  it('returns 401 when not authenticated', async () => {
    const { getSessionUser } = await import('@/lib/api/auth');
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(401);
    expect(data.success).toBe(false);
  });

  it('returns user API keys with hints (no encrypted key)', async () => {
    (prismaMock.userApiKey.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'key-1',
        provider: 'ANTHROPIC',
        keyHint: 'sk-ant-...xyz',
        label: null,
        isValid: true,
        lastUsedAt: null,
        lastError: null,
        createdAt: new Date(),
      },
    ]);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    const keys = data.data;
    expect(Array.isArray(keys)).toBe(true);
    expect(keys[0]).toHaveProperty('keyHint');
    expect(keys[0]).not.toHaveProperty('encryptedKey');
  });
});

describe('POST /api/api-keys', () => {
  it('returns 401 when not authenticated', async () => {
    const { getSessionUser } = await import('@/lib/api/auth');
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-test-key' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates a new key when none exists for provider', async () => {
    (prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.userApiKey.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-new',
      provider: 'ANTHROPIC',
      keyHint: 'sk-ant-...2345',
      label: null,
      isValid: true,
      createdAt: new Date(),
    });

    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-test-key-12345' },
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(201);
    expect(data.success).toBe(true);
    expect(prismaMock.userApiKey.create).toHaveBeenCalled();
  });

  it('updates existing key for same provider', async () => {
    (prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-existing',
      label: 'My key',
    });
    (prismaMock.userApiKey.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-existing',
      provider: 'ANTHROPIC',
      keyHint: 'sk-ant-...2345',
      label: 'My key',
      isValid: true,
      createdAt: new Date(),
    });

    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-new-key-12345' },
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(prismaMock.userApiKey.update).toHaveBeenCalled();
  });

  it('rejects missing provider', async () => {
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { apiKey: 'sk-ant-test' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects invalid provider', async () => {
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'INVALID', apiKey: 'sk-test' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
