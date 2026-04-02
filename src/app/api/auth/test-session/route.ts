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

  const testUser = await prisma.user.upsert({
    where: { email: 'e2e-test@buildclaws.ai' },
    update: {},
    create: {
      email: 'e2e-test@buildclaws.ai',
      name: 'E2E Test User',
      hasActiveSubscription: true,
    },
  });

  const token = await encode({
    token: {
      sub: testUser.id,
      email: testUser.email,
      name: testUser.name,
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
