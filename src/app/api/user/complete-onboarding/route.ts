import { NextRequest, NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

/**
 * Atomically: set User.onboardingCompleted=true AND re-issue the JWT cookie
 * with the claim flipped. Client-side useSession().update() is unreliable with
 * forged E2E cookies and can silently return null — this route is the
 * authoritative escape from the edge onboarding gate.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  await prisma.user.update({
    where: { id: user.id },
    data: { onboardingCompleted: true },
  })

  const existing = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!existing?.sub) {
    // DB is updated; client can fall back to SessionSync on next /onboarding load.
    return apiSuccess({ onboardingCompleted: true, cookieRefreshed: false })
  }

  const token = await encode({
    token: {
      ...existing,
      onboardingCompleted: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
    secret: process.env.NEXTAUTH_SECRET!,
  })

  const response = NextResponse.json({
    success: true,
    data: { onboardingCompleted: true, cookieRefreshed: true },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: `req_${Math.random().toString(36).slice(2, 14)}`,
    },
  })

  const isSecure =
    process.env.NEXTAUTH_URL?.startsWith("https") ||
    req.nextUrl.protocol === "https:"
  const cookieName = isSecure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token"

  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: Boolean(isSecure),
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  })

  return response
}
