import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encode } from 'next-auth/jwt';

/**
 * TEST ONLY - creates a JWT session cookie for E2E testing.
 * Only available when E2E_TEST_MODE=true.
 * DO NOT enable in production.
 */
export async function GET(req: NextRequest) {
  if (process.env.E2E_TEST_MODE !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const redirect = req.nextUrl.searchParams.get('redirect') || '/my-claws';
  const role = req.nextUrl.searchParams.get('role');
  const isAdmin = role === 'admin';
  const email = isAdmin ? 'e2e-admin@buildclaws.ai' : 'e2e-test@buildclaws.ai';
  const name = isAdmin ? 'E2E Admin User' : 'E2E Test User';

  // Batch B: E2E users must clear the shown-once onboarding gate. This route
  // encodes the JWT directly (skips Auth.js jwt callback), so the claim must
  // be on the cookie — otherwise proxy redirects /my-claws → /onboarding and
  // Playwright waitForURL('**/my-claws') times out.
  const testUser = await prisma.user.upsert({
    where: { email },
    update: { onboardingCompleted: true },
    create: {
      email,
      name,
      hasActiveSubscription: true,
      onboardingCompleted: true,
    },
  });

  const token = await encode({
    token: {
      sub: testUser.id,
      email: testUser.email,
      name: testUser.name,
      onboardingCompleted: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
    secret: process.env.NEXTAUTH_SECRET!,
  });

  const response = NextResponse.redirect(new URL(redirect, req.url));

  const isSecure = process.env.NEXTAUTH_URL?.startsWith('https') ?? false;
  const cookieName = isSecure
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';

  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  });

  return response;
}
