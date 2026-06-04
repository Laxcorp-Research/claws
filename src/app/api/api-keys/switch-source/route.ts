import { after } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { requestReconcileForUser } from "@/lib/openclaw/request-reconcile"
import { resolveMode } from "@/lib/openclaw/reconcile-mode"

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

  await prisma.user.update({
    where: { id: userId },
    data: { apiKeySource: "USER_OWN_KEY" },
  })

  await prisma.creditAccount.updateMany({
    where: { userId, status: "ACTIVE" },
    data: { status: "CONVERTED" },
  })

  const running = await prisma.workspace.findMany({
    where: { userId, status: { in: ["RUNNING", "HIBERNATED", "WAKING"] } },
  })

  // PR-8b/C (E3): the switch is REAL now — fire-and-forget reconcile of the
  // user's RUNNING containers (gated by ENV_RECONCILE_MODE inside healWorkspace).
  // Replaces the old TODO loop that only logged "Container recycle needed" while
  // the "~30 seconds" message was a lie.
  after(() => requestReconcileForUser(userId))

  // Mode-aware, truthful UX: only promise the ~30s restart when AUTO-HEAL is live;
  // under detect_only the change applies on the next sync, not in 30s.
  const message =
    resolveMode() === "auto_heal"
      ? "Your agents will restart with your own API key. This takes about ~30 seconds."
      : "Your agents will switch to your key on the next sync."

  return apiSuccess({
    switched: true,
    recyclingCount: running.length,
    message,
  })
}
