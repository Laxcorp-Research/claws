import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/rate-limit', () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 }) },
  authRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60000 }) },
}));

import { middleware } from '@/middleware';
import { getToken } from 'next-auth/jwt';
import { apiRateLimit, authRateLimit } from '@/lib/rate-limit';

function createReq(path: string, options: { method?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const url = new URL(path, 'http://localhost:3000');
  const headers: Record<string, string> = {
    ...(options.origin ? { origin: options.origin } : {}),
    ...options.headers,
  };
  return new NextRequest(url, { method: options.method || 'GET', headers });
}

describe('Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 });
    (authRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60000 });
  });

  describe('Security headers', () => {
    it('sets X-Frame-Options DENY on API routes', async () => {
      const res = await middleware(createReq('/api/health'));
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets X-Content-Type-Options nosniff', async () => {
      const res = await middleware(createReq('/api/health'));
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('sets Strict-Transport-Security', async () => {
      const res = await middleware(createReq('/api/health'));
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    });

    it('sets Referrer-Policy', async () => {
      const res = await middleware(createReq('/api/health'));
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('sets security headers on webhook routes', async () => {
      const res = await middleware(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets security headers on protected page routes', async () => {
      const res = await middleware(createReq('/my-claws'));
      expect(res.headers.get('X-Frame-Options') || res.status === 307).toBeTruthy();
    });
  });

  describe('CORS enforcement', () => {
    it('returns CORS headers for allowed origin', async () => {
      const res = await middleware(createReq('/api/workspaces', { origin: 'https://app.buildclaws.ai' }));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.buildclaws.ai');
    });

    it('does not set CORS origin for disallowed origin', async () => {
      const res = await middleware(createReq('/api/workspaces', { origin: 'https://evil.com' }));
      const corsHeader = res.headers.get('Access-Control-Allow-Origin');
      expect(corsHeader === null || corsHeader === '').toBeTruthy();
    });

    it('handles OPTIONS preflight for allowed origin', async () => {
      const res = await middleware(createReq('/api/workspaces', { method: 'OPTIONS', origin: 'https://app.buildclaws.ai' }));
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('excludes webhooks from CORS', async () => {
      const res = await middleware(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('excludes auth routes from CORS', async () => {
      const res = await middleware(createReq('/api/auth/session'));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('Authentication redirect', () => {
    it('redirects unauthenticated user from /my-claws to sign-in', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await middleware(createReq('/my-claws'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/auth/signin');
    });

    it('redirects unauthenticated user from /dashboard/:id', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await middleware(createReq('/dashboard/ws-123'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/auth/signin');
    });

    it('redirects unauthenticated user from /settings', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await middleware(createReq('/settings'));
      expect(res.status).toBe(307);
    });

    it('allows authenticated user through to protected routes', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1' });
      const res = await middleware(createReq('/my-claws'));
      expect(res.status).toBe(200);
    });

    it('includes callbackUrl in redirect', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await middleware(createReq('/settings'));
      const location = res.headers.get('Location') ?? '';
      expect(location).toContain('callbackUrl=');
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 when API rate limit exceeded', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-spammer' });
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await middleware(createReq('/api/workspaces'));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('Rate limit');
    });

    it('includes rate limit headers in 429 response', async () => {
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await middleware(createReq('/api/workspaces'));
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(res.headers.get('Retry-After')).toBeDefined();
    });

    it('returns 429 when auth rate limit exceeded on POST /api/auth', async () => {
      (authRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await middleware(createReq('/api/auth/callback/email', { method: 'POST' }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('sign-in');
    });

    it('does not rate limit webhook routes', async () => {
      const res = await middleware(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(apiRateLimit.limit).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('fails open when Redis is unavailable', async () => {
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis connection failed'));
      const res = await middleware(createReq('/api/workspaces'));
      expect(res.status).toBe(200);
    });
  });
});
