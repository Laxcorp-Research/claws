import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encode } from 'next-auth/jwt';

/**
 * TEST ONLY - creates a JWT session cookie for E2E testing.
 * Only available when E2E_TEST_MODE=true AND not on Vercel production.
 * DO NOT enable in production.
 */
export async function GET(req: NextRequest) {
  // Defense in depth: refuse unconditionally on Vercel production,
  // even if E2E_TEST_MODE were accidentally set.
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  if (process.env.E2E_TEST_MODE !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const redirect = req.nextUrl.searchParams.get('redirect') || '/my-claws';
  const role = req.nextUrl.searchParams.get('role');
  const isAdmin = role === 'admin';
  // Explicit false mode for the fresh-signup onboarding journey.
  // Default remains true so existing E2E helpers keep clearing the gate.
  const onboardingParam = req.nextUrl.searchParams.get('onboardingCompleted');
  const onboardingCompleted = onboardingParam === 'false' ? false : true;
  const email = isAdmin
    ? 'e2e-admin@buildclaws.ai'
    : onboardingCompleted
      ? 'e2e-test@buildclaws.ai'
      : 'e2e-onboarding@buildclaws.ai';
  const name = isAdmin
    ? 'E2E Admin User'
    : onboardingCompleted
      ? 'E2E Test User'
      : 'E2E Onboarding User';

  // Batch B: completed-mode users must clear the shown-once onboarding gate.
  // This route encodes the JWT directly (skips Auth.js jwt callback), so the
  // claim must be on the cookie — otherwise proxy redirects /my-claws →
  // /onboarding and Playwright waitForURL('**/my-claws') times out.
  // Incomplete-mode users keep the flag false for the fresh-signup journey.
  const testUser = await prisma.user.upsert({
    where: { email },
    update: { onboardingCompleted },
    create: {
      email,
      name,
      hasActiveSubscription: true,
      onboardingCompleted,
    },
  });

  // Fresh-signup journey: wipe prior DRAFT "My Claw 1" rows so the create
  // assertion can check for exactly one workspace after the click.
  if (!onboardingCompleted) {
    await prisma.workspace.deleteMany({
      where: { userId: testUser.id, name: 'My Claw 1', status: 'DRAFT' },
    });
  }

  const token = await encode({
    token: {
      sub: testUser.id,
      email: testUser.email,
      name: testUser.name,
      onboardingCompleted,
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
