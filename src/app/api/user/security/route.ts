import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const session = await getServerSession(authOptions)

  const [accounts, sessions] = await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id },
      select: { provider: true, providerAccountId: true },
    }),
    prisma.session.findMany({
      where: { userId: user.id },
      select: { id: true, expires: true, sessionToken: true },
    }),
  ])

  const providers = accounts.map((a) => ({
    provider: a.provider,
    connectedAt: new Date().toISOString(),
  }))

  const currentSessionToken = session?.user?.id ? session.user.id : null
  const activeSessions = sessions.map((s) => ({
    id: s.id,
    lastActive: s.expires.toISOString(),
    isCurrent: s.sessionToken === currentSessionToken || sessions.length === 1,
  }))

  return apiSuccess({ providers, sessions: activeSessions })
}
