import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/rate-limit', () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 }) },
  authRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60000 }) },
}));

import { proxy } from '@/proxy';
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

describe('Proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 });
    (authRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60000 });
  });

  describe('Security headers', () => {
    it('sets X-Frame-Options DENY on API routes', async () => {
      const res = await proxy(createReq('/api/health'));
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets X-Content-Type-Options nosniff', async () => {
      const res = await proxy(createReq('/api/health'));
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('sets Strict-Transport-Security', async () => {
      const res = await proxy(createReq('/api/health'));
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    });

    it('sets Referrer-Policy', async () => {
      const res = await proxy(createReq('/api/health'));
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('sets security headers on webhook routes', async () => {
      const res = await proxy(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets security headers on protected page routes when authenticated', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1', onboardingCompleted: true });
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('redirect response from protected route still reaches client securely', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(307);
    });
  });

  describe('CORS enforcement', () => {
    it('returns CORS headers for allowed origin', async () => {
      const res = await proxy(createReq('/api/workspaces', { origin: 'https://app.buildclaws.ai' }));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.buildclaws.ai');
    });

    it('does not set CORS origin for disallowed origin', async () => {
      const res = await proxy(createReq('/api/workspaces', { origin: 'https://evil.com' }));
      const corsHeader = res.headers.get('Access-Control-Allow-Origin');
      expect(corsHeader === null || corsHeader === '').toBeTruthy();
    });

    it('handles OPTIONS preflight for allowed origin', async () => {
      const res = await proxy(createReq('/api/workspaces', { method: 'OPTIONS', origin: 'https://app.buildclaws.ai' }));
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('excludes webhooks from CORS', async () => {
      const res = await proxy(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('excludes auth routes from CORS', async () => {
      const res = await proxy(createReq('/api/auth/session'));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('Authentication redirect', () => {
    it('redirects unauthenticated user from /my-claws to sign-in', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/auth/signin');
    });

    it('redirects unauthenticated user from /dashboard/:id', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await proxy(createReq('/dashboard/ws-123'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/auth/signin');
    });

    it('redirects unauthenticated user from /settings', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await proxy(createReq('/settings'));
      expect(res.status).toBe(307);
    });

    it('allows authenticated user through to protected routes', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1', onboardingCompleted: true });
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(200);
    });

    it('Batch B: incomplete onboarding → redirect /my-claws to /onboarding', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1', onboardingCompleted: false });
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/onboarding');
    });

    it('Batch B: incomplete onboarding may still open /settings (API key CTA)', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1', onboardingCompleted: false });
      const res = await proxy(createReq('/settings'));
      expect(res.status).toBe(200);
    });

    it('Batch B: MUTATION always-redirect - completed users must reach /my-claws', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-1', onboardingCompleted: true });
      const res = await proxy(createReq('/my-claws'));
      expect(res.status).toBe(200);
      expect(res.headers.get('Location')).toBeNull();
    });

    it('includes callbackUrl in redirect', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await proxy(createReq('/settings'));
      const location = res.headers.get('Location') ?? '';
      expect(location).toContain('callbackUrl=');
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 when API rate limit exceeded', async () => {
      (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: 'user-spammer' });
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await proxy(createReq('/api/workspaces'));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('Rate limit');
    });

    it('includes rate limit headers in 429 response', async () => {
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await proxy(createReq('/api/workspaces'));
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(res.headers.get('Retry-After')).toBeDefined();
    });

    it('returns 429 when auth rate limit exceeded on POST /api/auth', async () => {
      (authRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 });
      const res = await proxy(createReq('/api/auth/callback/email', { method: 'POST' }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('sign-in');
    });

    it('does not rate limit webhook routes', async () => {
      const res = await proxy(createReq('/api/dodo-payments/webhook', { method: 'POST' }));
      expect(apiRateLimit.limit).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('fails open when Redis is unavailable', async () => {
      (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis connection failed'));
      const res = await proxy(createReq('/api/workspaces'));
      expect(res.status).toBe(200);
    });
  });
});

describe('Admin authorization at the edge (#133)', () => {
  const ADMIN = 'chatianyalaxman118@gmail.com';
  const origAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    (apiRateLimit.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 });
  });

  afterEach(() => {
    if (origAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = origAdminEmails;
    vi.restoreAllMocks();
  });

  it('no token on /admin → sign-in redirect (auth gate unchanged)', async () => {
    process.env.ADMIN_EMAILS = ADMIN;
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await proxy(createReq('/admin/versions'));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/auth/signin');
  });

  // The #133 fix: a logged-in NON-admin must NOT receive the admin route.
  // Mutation: delete the /admin block in proxy.ts → this fails (the
  // non-admin would pass through with no rewrite, the old vulnerable behavior).
  it('non-admin token + ADMIN_EMAILS set → 404 rewrite to not-found, NOT the admin route', async () => {
    process.env.ADMIN_EMAILS = ADMIN;
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-2',
      email: 'random@user.com',
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/admin/versions'));
    expect(res.headers.get('x-middleware-rewrite') ?? '').toContain('/_not-found');
    expect(res.headers.get('Location')).toBeNull(); // not a redirect; a rewrite (URL stays /admin/*)
  });

  it('admin token (the operator account) → passes through to the admin route', async () => {
    process.env.ADMIN_EMAILS = ADMIN;
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-1',
      email: ADMIN,
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/admin/versions'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('admin match is case-insensitive', async () => {
    process.env.ADMIN_EMAILS = ADMIN;
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-1',
      email: ADMIN.toUpperCase(),
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/admin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  // Fail-SAFE on config: an env wipe must NOT 404 every admin (self-lockout).
  // Mutation: make an empty allowlist hard-404 → this fails.
  it('ADMIN_EMAILS unset → does NOT 404 a non-admin; falls through + logs', async () => {
    delete process.env.ADMIN_EMAILS;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-2',
      email: 'random@user.com',
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/admin/versions'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('edge admin enforcement DISABLED'));
  });

  it('ADMIN_EMAILS whitespace-only → treated as unset (fall through, no 404)', async () => {
    process.env.ADMIN_EMAILS = '   ';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-2',
      email: 'random@user.com',
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/admin'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('non-admin on a NON-admin protected route is unaffected (still passes)', async () => {
    process.env.ADMIN_EMAILS = ADMIN;
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sub: 'u-2',
      email: 'random@user.com',
      onboardingCompleted: true,
    });
    const res = await proxy(createReq('/my-claws'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});

describe('Proxy-safety guard (#133)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  // admin-emails.ts must stay import-free so it can't drag Node-only or
  // next-auth/server code into the proxy bundle.
  // Mutation: add any import to admin-emails.ts → this fails.
  it('src/lib/admin-emails.ts is import-free', () => {
    const src = read('src/lib/admin-emails.ts');
    expect(/^\s*import\s/m.test(src)).toBe(false);
  });

  it('proxy imports the allowlist from the edge-safe module, not the server admin module', () => {
    const src = read('src/proxy.ts');
    expect(src).toContain('./lib/admin-emails');
    expect(src).not.toContain('@/lib/api/admin'); // would pull in getServerSession/Prisma into the edge bundle
    expect(src).not.toContain('getServerSession');
  });
});
