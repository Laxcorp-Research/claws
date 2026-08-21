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

const mockValidateApiKey = vi.fn();
vi.mock('@/lib/api-key-validation', () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

// PR-8b/C: after() captures (does not run) the fire-and-forget callback so we can
// assert the response is returned WITHOUT waiting on the reconcile, then invoke
// the captured callback to verify requestReconcileForUser(userId) fires.
const mockAfter = vi.fn();
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) };
});
const mockRequestReconcile = vi.fn();
vi.mock('@/lib/openclaw/request-reconcile', () => ({
  requestReconcileForUser: (...a: unknown[]) => mockRequestReconcile(...a),
}));

import { GET, POST } from '@/app/api/api-keys/route';

beforeEach(() => {
  mockAfter.mockClear();
  mockRequestReconcile.mockReset();
  mockRequestReconcile.mockResolvedValue(undefined);
  mockValidateApiKey.mockReset();
  mockValidateApiKey.mockResolvedValue({ valid: true });
});

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

  it('accepts OPENROUTER (real BYOK - validates then stores)', async () => {
    mockValidateApiKey.mockResolvedValueOnce({ valid: true });
    (prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.userApiKey.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-or',
      provider: 'OPENROUTER',
      keyHint: 'sk-o…test',
      label: null,
      isValid: true,
      createdAt: new Date(),
    });
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'OPENROUTER', apiKey: 'sk-or-test' },
    });
    const res = await POST(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(201);
    expect(mockValidateApiKey).toHaveBeenCalledWith('OPENROUTER', 'sk-or-test');
    expect(prismaMock.userApiKey.create).toHaveBeenCalled();
  });

  it('rejects OLLAMA with 400', async () => {
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'OLLAMA', apiKey: 'local' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects invalid key before storing (live validate)', async () => {
    mockValidateApiKey.mockResolvedValueOnce({ valid: false, error: 'Invalid API key' });
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST',
      body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-bad' },
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);
    expect(status).toBe(400);
    expect(data.error.message).toMatch(/Invalid API key/i);
    expect(prismaMock.userApiKey.create).not.toHaveBeenCalled();
    expect(prismaMock.userApiKey.update).not.toHaveBeenCalled();
  });

  // PR-8b/C (E1): adding/updating a key schedules a fire-and-forget reconcile.
  it('on create → schedules requestReconcileForUser(userId) via after(), not synchronously', async () => {
    (prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.userApiKey.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-new', provider: 'ANTHROPIC', keyHint: 'sk-ant-...2345', label: null, isValid: true, createdAt: new Date(),
    });
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST', body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-test-key-12345' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    // Scheduled, not run inline (fire-and-forget → response not blocked on it).
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRequestReconcile).not.toHaveBeenCalled();
    // Running the captured callback fires the reconcile with the session userId.
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)();
    expect(mockRequestReconcile).toHaveBeenCalledWith('user-test-123');
  });

  it('on update → schedules requestReconcileForUser(userId) via after()', async () => {
    (prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'key-existing', label: 'My key' });
    (prismaMock.userApiKey.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-existing', provider: 'ANTHROPIC', keyHint: 'sk-ant-...2345', label: 'My key', isValid: true, createdAt: new Date(),
    });
    const req = createMockRequest('http://localhost:3000/api/api-keys', {
      method: 'POST', body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-new-key-12345' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)();
    expect(mockRequestReconcile).toHaveBeenCalledWith('user-test-123');
  });
});
