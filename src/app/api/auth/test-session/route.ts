import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

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
      subscriptionTier: 'PRO',
    },
  });

  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      sessionToken,
      userId: testUser.id,
      expires,
    },
  });

  const response = NextResponse.redirect(new URL(redirect, req.url));

  response.cookies.set('next-auth.session-token', sessionToken, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    expires,
  });

  return response;
}
