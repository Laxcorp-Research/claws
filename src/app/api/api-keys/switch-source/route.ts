import { after } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { requestReconcileForUser } from "@/lib/openclaw/request-reconcile"
import { resolveMode } from "@/lib/openclaw/reconcile-mode"
import { convertUserToByok } from "@/lib/credits/byok-recovery"

// PR-8b/C: headroom for after()'s fire-and-forget reconcile.
export const maxDuration = 30

export async function POST() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const userId = user.id

  const validKey = await prisma.userApiKey.findFirst({
    where: { userId, provider: "ANTHROPIC", isValid: true },
  })

  if (!validKey) {
    return apiError("NO_VALID_KEY", "Add and validate an Anthropic API key first", 400)
  }

  const { rearmedHibernated } = await convertUserToByok(userId)

  const running = await prisma.workspace.findMany({
    where: { userId, status: { in: ["RUNNING", "HIBERNATED", "WAKING"] } },
  })

  after(() => requestReconcileForUser(userId))

  const message =
    resolveMode() === "auto_heal"
      ? "Your agents will restart with your own API key. This takes about ~30 seconds."
      : "Your agents will switch to your key on the next sync."

  return apiSuccess({
    switched: true,
    recyclingCount: running.length,
    rearmedHibernated,
    message,
  })
}
